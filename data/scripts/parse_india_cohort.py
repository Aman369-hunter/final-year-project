#!/usr/bin/env python3
"""Parse Table 1 of Sheth et al. 2024 (JIMD Reports) - 32 adult Indian LSD patients.

Columns: Patient ID | Phenotype | Sex | Age at diagnosis | Enzyme name |
         Enzyme activity | Chitotriosidase | Disease | Gene | Variant | Zygosity
"""
import re, csv, sys

SRC = ("/tmp/txt/JIMD Reports - 2024 - Sheth - Lysosomal storage disorders "
       "identified in adult population from India  Experience of a.txt")
OUT = "/home/claude/lsd/data/india_cohort.csv"

IN_SCOPE = {"gaucher", "fabry", "pompe", "mps1", "krabbe", "niemann_pick_c"}

# Gene is the authoritative label. Disease text is ambiguous: "MPS-I" is a
# substring of "MPS-IVA", so naive matching silently mislabels Morquio (GALNS)
# as Hurler (IDUA). Gene first, text only as fallback.
GENE_TO_DISEASE = {
    "GBA": "gaucher", "GBA1": "gaucher",
    "GLA": "fabry",
    "GAA": "pompe",
    "IDUA": "mps1",
    "NPC1": "niemann_pick_c", "NPC2": "niemann_pick_c",
    "GALC": "krabbe",
    "SMPD1": "niemann_pick_ab",
    "GALNS": "other:MPS-IVA", "ARSA": "other:MLD", "PSAP": "other:MLD-SapB",
    "NEU1": "other:sialidosis", "GNPTAB": "other:ML-II/III",
}


def norm_disease(raw, gene=""):
    g = re.sub(r"[^A-Za-z0-9]", "", (gene or "")).upper()
    if g in GENE_TO_DISEASE:
        return GENE_TO_DISEASE[g]
    r = raw.lower().strip()
    if "niemann" in r:
        return "niemann_pick_c" if re.search(r"\btype\s*c\b|\bnpc\b", r) else "niemann_pick_ab"
    # word-boundary matching so MPS-I does not swallow MPS-IVA
    if re.search(r"\bmps[\s\-]?(i|1)\b(?![vx])", r):
        return "mps1"
    for k, v in (("gaucher", "gaucher"), ("fabry", "fabry"),
                 ("pompe", "pompe"), ("krabbe", "krabbe")):
        if k in r:
            return v
    return f"other:{raw.strip()}"


def main():
    text = open(SRC, errors="ignore").read()
    lines = text.split("\n")

    # A patient row begins with P<n> followed by whitespace
    starts = [i for i, l in enumerate(lines) if re.match(r"^\s*P\d{1,2}\s{2,}", l)]
    if not starts:
        print("no patient rows found", file=sys.stderr)
        sys.exit(1)

    records = {}
    for idx, i in enumerate(starts):
        block = [lines[i]]
        # absorb continuation lines until the next patient row or a blank gap
        j = i + 1
        while j < len(lines) and j not in starts:
            if re.match(r"^\s*P\d{1,2}\s{2,}", lines[j]):
                break
            block.append(lines[j])
            j += 1
            if j - i > 8:
                break

        head = re.split(r"\s{3,}", lines[i].strip())
        if len(head) < 8:
            continue
        pid = head[0].strip()
        if pid in records:
            continue

        # continuation text (extra phenotype wording, extra variant alleles)
        cont = " ".join(re.sub(r"\s{3,}", " ", l.strip()) for l in block[1:] if l.strip())
        cont = re.sub(r"\s*P\d{1,2}\s.*$", "", cont)        # drop any bleed-through

        phen = head[1].strip()
        extra_phen = re.sub(r"\(p\.[^)]+\)|c\.\S+|heterozygous|homozygous|hemizygous",
                            "", cont, flags=re.I).strip(" |,;")
        if extra_phen and len(extra_phen) > 3:
            phen = f"{phen} {extra_phen}".strip()
        phen = re.sub(r"\s+", " ", phen)

        sex = head[2].strip().upper()[:1]
        age = head[3].strip()
        enzyme_name = head[4].strip()
        enzyme_act = head[5].strip()
        chito = head[6].strip().replace(" ", "")
        disease_raw = head[7].strip()
        gene = head[8].strip() if len(head) > 8 else ""
        variant = head[9].strip() if len(head) > 9 else ""
        zyg = head[10].strip() if len(head) > 10 else ""

        # second allele / protein change from continuation
        prot = re.findall(r"\(p\.[^)]+\)", cont)
        cdna = re.findall(r"c\.\S+", cont)
        all_variants = [v for v in [variant] + cdna if v]
        if prot:
            all_variants += prot
        if re.search(r"compound", zyg, re.I) or re.search(r"compound", cont, re.I):
            zyg = "compound heterozygous"
        elif re.search(r"homozygous", zyg + " " + cont, re.I):
            zyg = "homozygous"
        elif re.search(r"hemizygous", zyg + " " + cont, re.I):
            zyg = "hemizygous"
        elif re.search(r"heterozygous", zyg + " " + cont, re.I):
            zyg = "heterozygous"

        # "ND" = not done; treat as missing, never as a value
        if chito.upper() in ("ND", "NA", "-", ""):
            chito = ""
        if enzyme_act.upper() in ("ND", "NA", "-", ""):
            enzyme_act = ""
        if zyg.upper() in ("ND", "NA", "-"):
            zyg = ""

        records[pid] = {
            "source": "sheth_2024_india_adults",
            "patient_id": pid,
            "disease": norm_disease(disease_raw, gene),
            "disease_raw": disease_raw,
            "sex": {"M": "male", "F": "female"}.get(sex, "unknown"),
            "age_at_diagnosis_years": age if re.match(r"^\d", age) else "",
            "phenotype_text": phen,
            "enzyme_name": enzyme_name,
            "enzyme_activity": enzyme_act,
            "enzyme_unit": "nmol/h/mg protein",
            "chitotriosidase": chito,
            "gene": gene,
            "variants": ";".join(dict.fromkeys(all_variants)),
            "zygosity": zyg.lower(),
        }

    rows = [records[k] for k in sorted(records, key=lambda x: int(x[1:]))]
    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    from collections import Counter
    c = Counter(r["disease"] for r in rows)
    print(f"parsed {len(rows)} patients")
    for d, n in c.most_common():
        mark = "  " if d in IN_SCOPE else " *"
        print(f"{mark}{d:<24}{n:>3}")
    print(f"\n* = outside our 6 diseases")
    withe = sum(1 for r in rows if r["enzyme_activity"])
    withv = sum(1 for r in rows if r["variants"])
    print(f"\nwith enzyme value: {withe}/{len(rows)}   with variant: {withv}/{len(rows)}")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
