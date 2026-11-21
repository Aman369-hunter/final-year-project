#!/usr/bin/env python3
"""Build the variant lookup the lab dashboard uses for autocomplete.

Technicians should pick a known variant rather than free-typing HGVS, which is
error-prone. Output is one JSON per gene plus a combined index.
"""
import csv, glob, json, re, os
from collections import defaultdict

SRC = "/mnt/user-data/uploads/Desktop/final year project dataset"
OUT = "/home/claude/lsd/data/variants"

GENE_DISEASE = {
    "GBA1": "gaucher", "GLA": "fabry", "GAA": "pompe", "IDUA": "mps1",
    "NPC1": "niemann_pick_c", "NPC2": "niemann_pick_c", "GALC": "krabbe",
    "SMPD1": "niemann_pick_ab",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    by_gene = defaultdict(dict)

    for path in sorted(glob.glob(f"{SRC}/clinvar_download_*.tsv")):
        with open(path, errors="ignore") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                genes = (row.get("Gene(s)") or "").replace(" ", "")
                name = (row.get("Name") or "").strip()
                clin = (row.get("Germline classification") or "").strip()
                if not name or not clin:
                    continue
                for g in genes.split("|"):
                    if g not in GENE_DISEASE:
                        continue
                    # HGVS coding change, e.g. NM_000157.4(GBA1):c.1226A>G (p.Asn409Ser)
                    m = re.search(r":(c\.[^ ]+)", name)
                    cdna = m.group(1) if m else ""
                    p = re.search(r"\((p\.[^)]+)\)\s*$", name)
                    prot = p.group(1) if p else ""
                    key = cdna or name
                    if key in by_gene[g]:
                        continue
                    by_gene[g][key] = {
                        "cdna": cdna,
                        "protein": prot,
                        "classification": clin.lower(),
                        "variation_id": row.get("VariationID", ""),
                        "dbsnp": row.get("dbSNP ID", ""),
                        "consequence": row.get("Molecular consequence", ""),
                        "full_name": name[:160],
                    }

    index = {}
    for gene, variants in by_gene.items():
        items = sorted(variants.values(), key=lambda v: (v["classification"], v["cdna"]))
        payload = {
            "gene": gene,
            "disease": GENE_DISEASE[gene],
            "source": "ClinVar, pathogenic + likely pathogenic only",
            "retrieved": "2026-11-15",
            "count": len(items),
            "variants": items,
        }
        with open(f"{OUT}/{gene}.json", "w") as fh:
            json.dump(payload, fh, indent=1)
        index[gene] = {"disease": GENE_DISEASE[gene], "count": len(items),
                       "file": f"variants/{gene}.json"}

    with open(f"{OUT}/index.json", "w") as fh:
        json.dump(index, fh, indent=2)

    print(f"{'gene':<10}{'disease':<20}{'variants':>9}")
    for g in sorted(index):
        print(f"{g:<10}{index[g]['disease']:<20}{index[g]['count']:>9}")
    print(f"\ntotal {sum(v['count'] for v in index.values())} unique variants -> {OUT}/")


if __name__ == "__main__":
    main()
