#!/usr/bin/env python3
"""Build the disease knowledge table for the 6 LSDs from HPO + Orphanet annotations."""
import csv, re, sys
from collections import defaultdict

DATA = "/home/claude/lsd/data"

# Disease registry: our 6 diseases, with every OMIM/ORPHA id that maps to them.
DISEASES = {
    "gaucher": {
        "display": "Gaucher disease", "gene": ["GBA1"], "inheritance": "AR",
        "enzyme": "GBA", "biomarkers": ["lyso_Gb1", "chitotriosidase"],
        "ids": ["ORPHA:355", "ORPHA:77259", "ORPHA:77260", "ORPHA:77261",
                "OMIM:230800", "OMIM:230900", "OMIM:231000"],
    },
    "fabry": {
        "display": "Fabry disease", "gene": ["GLA"], "inheritance": "XL",
        "enzyme": "alpha_Gal_A", "biomarkers": ["lyso_Gb3"],
        "ids": ["ORPHA:324", "OMIM:301500"],
    },
    "pompe": {
        "display": "Pompe disease", "gene": ["GAA"], "inheritance": "AR",
        "enzyme": "GAA", "biomarkers": ["CK"],
        "ids": ["ORPHA:365", "ORPHA:308552", "OMIM:232300"],
    },
    "mps1": {
        "display": "Mucopolysaccharidosis type I", "gene": ["IDUA"], "inheritance": "AR",
        "enzyme": "IDUA", "biomarkers": ["urinary_GAG"],
        "ids": ["ORPHA:579", "OMIM:607014", "OMIM:607015", "OMIM:607016"],
    },
    "niemann_pick_c": {
        "display": "Niemann-Pick disease type C", "gene": ["NPC1", "NPC2"], "inheritance": "AR",
        "enzyme": None, "biomarkers": ["oxysterols", "lyso_SM_509"],
        "ids": ["ORPHA:646", "OMIM:257220", "OMIM:607625"],
    },
    "krabbe": {
        "display": "Krabbe disease", "gene": ["GALC"], "inheritance": "AR",
        "enzyme": "GALC", "biomarkers": ["psychosine"],
        "ids": ["ORPHA:487", "ORPHA:206436", "ORPHA:206443", "ORPHA:206448",
                "OMIM:245200"],
    },
}

# HPO frequency term -> (midpoint probability, scoring points)
FREQ_TERMS = {
    "HP:0040280": ("Obligate",      1.00, 8),
    "HP:0040281": ("Very frequent", 0.895, 6),
    "HP:0040282": ("Frequent",      0.545, 4),
    "HP:0040283": ("Occasional",    0.17, 2),
    "HP:0040284": ("Very rare",     0.025, 1),
    "HP:0040285": ("Excluded",      0.0,  0),
}


def load_hpo_names(path):
    """Parse hp.obo -> {HP:id: name}, skipping obsolete terms."""
    names, cur, obsolete = {}, None, False
    with open(path) as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line == "[Term]":
                cur, obsolete = None, False
            elif line.startswith("id: HP:"):
                cur = line[4:]
            elif line.startswith("name: ") and cur and not obsolete:
                names[cur] = line[6:]
            elif line.startswith("is_obsolete: true"):
                obsolete = True
                if cur:
                    names.pop(cur, None)
    return names


# Terms that are LABORATORY RESULTS, not clinical signs. These must never sit in
# the symptom track: the enzyme and biomarker values are separate model inputs, so
# leaving them here would leak the answer and let the model learn
# "low enzyme -> disease" through the symptom channel.
LAB_PATTERNS = [
    r"\bactivity\b", r"\bconcentration\b", r"excretion in urine",
    r"esterification rate", r"\benzyme\b", r"\bserum level\b",
    r"^Elevated circulating", r"^Decreased circulating", r"^Reduced tissue",
    r"^Diminished tissue", r"\bplasma\b",
]
LAB_RE = re.compile("|".join(LAB_PATTERNS), re.IGNORECASE)


def classify_term(label):
    return "lab_derived" if LAB_RE.search(label) else "symptom"


def parse_frequency(raw):
    """HPOA frequency column -> (probability, points, source_kind, n_denominator).

    Raw counts are shrunk with a Beta(1,1) posterior mean, (k+1)/(n+2), so a 1/1
    observation from a single case report becomes 0.67 rather than a spurious
    100%. Without this, singleton case reports outrank large-cohort frequency
    bands and dominate the generator.
    """
    if not raw:
        return None, None, "unspecified", None
    raw = raw.strip()
    if raw in FREQ_TERMS:
        _, prob, pts = FREQ_TERMS[raw]
        return prob, pts, "band", None
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", raw)          # e.g. 134/699
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        if den == 0:
            return None, None, "unspecified", None
        prob = (num + 1) / (den + 2)                   # Beta(1,1) posterior mean
        return prob, prob_to_points(prob), f"count:{num}/{den}", den
    m = re.match(r"^([\d.]+)\s*%$", raw)                # e.g. 42%
    if m:
        prob = float(m.group(1)) / 100.0
        return prob, prob_to_points(prob), "percent", None
    return None, None, "unspecified", None


def prob_to_points(p):
    if p >= 0.995: return 8
    if p >= 0.80:  return 6
    if p >= 0.30:  return 4
    if p >= 0.05:  return 2
    if p > 0:      return 1
    return 0


def main():
    names = load_hpo_names(f"{DATA}/hp.obo")
    print(f"HPO terms loaded: {len(names)}", file=sys.stderr)

    id_to_disease = {}
    for key, meta in DISEASES.items():
        for did in meta["ids"]:
            id_to_disease[did] = key

    # disease -> hpo_id -> best record (prefer banded frequency, then higher prob)
    collected = defaultdict(dict)
    excluded = defaultdict(set)

    with open(f"{DATA}/phenotype.hpoa") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if parts[0] == "database_id":
                continue
            if len(parts) < 12:
                continue
            db_id, dis_name, qualifier, hpo_id = parts[0], parts[1], parts[2], parts[3]
            freq_raw, aspect = parts[7], parts[10]
            disease = id_to_disease.get(db_id)
            if not disease:
                continue
            if aspect != "P":          # keep phenotypic abnormalities only
                continue
            if qualifier == "NOT":
                excluded[disease].add(hpo_id)
                continue

            prob, pts, src, denom = parse_frequency(freq_raw)
            label = names.get(hpo_id, "(unknown term)")
            rec = {
                "hpo_id": hpo_id,
                "label": label,
                "category": classify_term(label),
                "probability": prob,
                "points": pts,
                "freq_source": src,
                "evidence_n": denom,
                "source_db": db_id,
                "source_disease_name": dis_name,
            }
            prev = collected[disease].get(hpo_id)
            if prev is None or _better(rec, prev):
                collected[disease][hpo_id] = rec

    rows = []
    for disease, meta in DISEASES.items():
        for hpo_id, rec in collected[disease].items():
            if hpo_id in excluded[disease]:
                continue
            rows.append({
                "disease": disease,
                "disease_display": meta["display"],
                "gene": "|".join(meta["gene"]),
                "inheritance": meta["inheritance"],
                "category": rec["category"],
                "hpo_id": rec["hpo_id"],
                "symptom": rec["label"],
                "probability": f"{rec['probability']:.4f}" if rec["probability"] is not None else "",
                "points": rec["points"] if rec["points"] is not None else "",
                "freq_source": rec["freq_source"],
                "evidence_n": rec["evidence_n"] if rec["evidence_n"] is not None else "",
                "source_db": rec["source_db"],
            })

    rows.sort(key=lambda r: (r["disease"], r["category"],
                             -(float(r["probability"]) if r["probability"] else -1)))

    out = f"{DATA}/knowledge_table.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # summary
    print(f"\n{'disease':<20}{'symptom':>9}{'lab':>6}{'w/freq':>8}{'cov':>6}")
    for disease in DISEASES:
        sub = [r for r in rows if r["disease"] == disease]
        sym = [r for r in sub if r["category"] == "symptom"]
        lab = [r for r in sub if r["category"] == "lab_derived"]
        wf = [r for r in sym if r["probability"]]
        cov = f"{100*len(wf)/len(sym):.0f}%" if sym else "-"
        print(f"{disease:<20}{len(sym):>9}{len(lab):>6}{len(wf):>8}{cov:>6}")
    nsym = len([r for r in rows if r['category'] == 'symptom'])
    nlab = len([r for r in rows if r['category'] == 'lab_derived'])
    print(f"\nTOTAL {len(rows)} rows  ({nsym} symptom, {nlab} lab-derived held out)")
    print(f"  -> {out}")


def _better(new, old):
    if (new["probability"] is not None) and (old["probability"] is None):
        return True
    if (new["probability"] is None) and (old["probability"] is not None):
        return False
    if new["probability"] is None:
        return False
    # prefer explicit bands over raw counts, then higher probability
    new_band = new["freq_source"] == "band"
    old_band = old["freq_source"] == "band"
    if new_band != old_band:
        return new_band
    return new["probability"] > old["probability"]


if __name__ == "__main__":
    main()
