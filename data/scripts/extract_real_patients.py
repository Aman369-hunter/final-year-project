#!/usr/bin/env python3
"""Extract real labelled patients from Phenopacket Store into CSV rows."""
import json, csv, os, glob, re, sys

PS = "/tmp/ps/x/0.1.27"
OUT = "/home/claude/lsd/data/real_patients.csv"

GENE_TO_DISEASE = {
    "GBA1": "gaucher", "GBA": "gaucher",
    "GLA": "fabry",
    "GAA": "pompe",
    "IDUA": "mps1",
    "NPC1": "niemann_pick_c", "NPC2": "niemann_pick_c",
    "GALC": "krabbe",
    "SMPD1": "niemann_pick_ab",     # out of scope, kept for reference
}
NAME_PATTERNS = [
    (re.compile(r"gaucher", re.I), "gaucher"),
    (re.compile(r"fabry", re.I), "fabry"),
    (re.compile(r"pompe|acid maltase|glycogen storage disease (ii|2)", re.I), "pompe"),
    (re.compile(r"mucopolysaccharidosis type (i|1)\b|hurler|scheie", re.I), "mps1"),
    (re.compile(r"niemann.?pick.*(type )?c", re.I), "niemann_pick_c"),
    (re.compile(r"krabbe|globoid", re.I), "krabbe"),
    (re.compile(r"niemann.?pick.*(type )?(a|b)", re.I), "niemann_pick_ab"),
]
IN_SCOPE = {"gaucher", "fabry", "pompe", "mps1", "niemann_pick_c", "krabbe"}


def label_from(disease_terms, genes):
    for term in disease_terms:
        for rx, key in NAME_PATTERNS:
            if rx.search(term):
                return key
    for g in genes:
        if g in GENE_TO_DISEASE:
            return GENE_TO_DISEASE[g]
    return None


def iso_to_years(s):
    if not s:
        return ""
    m = re.match(r"^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$", s)
    if not m:
        return ""
    y = int(m.group(1) or 0) + int(m.group(2) or 0) / 12 + int(m.group(3) or 0) / 365
    return f"{y:.2f}"


def main():
    rows = []
    for path in glob.glob(f"{PS}/**/*.json", recursive=True):
        try:
            with open(path) as fh:
                pp = json.load(fh)
        except Exception:
            continue

        disease_terms, genes = [], []
        for d in pp.get("diseases", []):
            t = d.get("term", {}).get("label")
            if t:
                disease_terms.append(t)
        for interp in pp.get("interpretations", []):
            diag = interp.get("diagnosis", {})
            t = diag.get("disease", {}).get("label")
            if t:
                disease_terms.append(t)
            for gi in diag.get("genomicInterpretations", []):
                vi = gi.get("variantInterpretation", {})
                vd = vi.get("variationDescriptor", {})
                sym = vd.get("geneContext", {}).get("symbol")
                if sym:
                    genes.append(sym)

        label = label_from(disease_terms, genes)
        if label not in IN_SCOPE:
            continue

        present, absent = [], []
        onset = ""
        for pf in pp.get("phenotypicFeatures", []):
            tid = pf.get("type", {}).get("id", "")
            if not tid.startswith("HP:"):
                continue
            if pf.get("excluded"):
                absent.append(tid)
            else:
                present.append(tid)
                if not onset:
                    o = pf.get("onset", {}).get("age", {}).get("iso8601duration")
                    if o:
                        onset = o

        subj = pp.get("subject", {})
        sex = {"MALE": "male", "FEMALE": "female"}.get(subj.get("sex", ""), "unknown")
        age = subj.get("timeAtLastEncounter", {}).get("age", {}).get("iso8601duration", "")

        variants = []
        for interp in pp.get("interpretations", []):
            for gi in interp.get("diagnosis", {}).get("genomicInterpretations", []):
                vd = gi.get("variantInterpretation", {}).get("variationDescriptor", {})
                exp = [e.get("value") for e in vd.get("expressions", [])
                       if e.get("syntax") == "hgvs.c"]
                zyg = vd.get("allelicState", {}).get("label", "")
                if exp:
                    variants.append(f"{exp[0]}({zyg})" if zyg else exp[0])

        rows.append({
            "source": "phenopacket_store",
            "patient_id": pp.get("id", os.path.basename(path)),
            "disease": label,
            "sex": sex,
            "age_years": iso_to_years(age),
            "onset_age_years": iso_to_years(onset),
            "gene": "|".join(sorted(set(genes))),
            "variants": ";".join(variants),
            "n_hpo_present": len(present),
            "hpo_present": ";".join(present),
            "hpo_absent": ";".join(absent),
            "pmid": ";".join(sorted({
                m.get("reference", {}).get("id", "")
                for mc in pp.get("metaData", {}).get("externalReferences", [])
                for m in [{"reference": mc}]
                if mc.get("id")
            })),
        })

    rows.sort(key=lambda r: (r["disease"], r["patient_id"]))
    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    from collections import Counter
    c = Counter(r["disease"] for r in rows)
    print(f"{'disease':<20}{'patients':>9}{'median HPO terms':>19}")
    for d in sorted(c):
        sub = sorted(int(r["n_hpo_present"]) for r in rows if r["disease"] == d)
        med = sub[len(sub) // 2]
        print(f"{d:<20}{c[d]:>9}{med:>19}")
    print(f"\nTOTAL {len(rows)} real labelled patients -> {OUT}")


if __name__ == "__main__":
    main()
