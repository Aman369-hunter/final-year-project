#!/usr/bin/env python3
"""Validate the scoring engine against the 35 real patients.

The headline test is SYMPTOMS ONLY. That is the clinical question the system
exists to answer: before any expensive assay has been ordered, does the
presentation point at the right disease?

Feeding the engine the confirmatory enzyme result and then asking whether it
reaches the confirmed diagnosis would be circular, so that run is reported
separately and clearly labelled.
"""
import csv, json, re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from score import predict, DISEASES, DISPLAY
from weights import SYMPTOM_LABELS

DATA = os.environ.get("LSD_DATA", os.path.join(HERE, "..", "data"))

# Map free-text clinical descriptions (India cohort) onto HPO ids. Built by
# matching against the knowledge table's own labels, plus clinical synonyms that
# appear in case descriptions but not in HPO's preferred terms.
SYNONYMS = {
    "hepatosplenomegaly": ["HP:0001433"],
    "splenomegaly": ["HP:0001744"],
    "hepatomegaly": ["HP:0002240"],
    "anaemia": ["HP:0001903"], "anemia": ["HP:0001903"],
    "thrombocytopenia": ["HP:0001873"],
    "avascular necrosis": ["HP:0010885"],
    "bone pain": ["HP:0002653"],
    "short stature": ["HP:0004322"],
    "skeletal dysplasia": ["HP:0002652"],
    "coarse facial": ["HP:0000280"], "coarse facies": ["HP:0000280"],
    "corneal": ["HP:0007957"],
    "joint stiffness": ["HP:0001387"], "contracture": ["HP:0001371"],
    "angiokeratoma": ["HP:0001014"],
    "acroparesthesia": ["HP:0003401"], "acroperasis": ["HP:0003401"],
    "stroke": ["HP:0001297"],
    "proteinuria": ["HP:0000093"],
    "renal failure": ["HP:0000083"], "renal insufficiency": ["HP:0000083"],
    "cardiomyopathy": ["HP:0001638"],
    "hypertrophic cardiomyopathy": ["HP:0001639"],
    "cardiomegaly": ["HP:0001640"],
    "muscle weakness": ["HP:0001324"],
    "limb girdle": ["HP:0003325"],
    "respiratory": ["HP:0002093"],
    "developmental delay": ["HP:0001263"],
    "regression": ["HP:0002376"],
    "seizure": ["HP:0001250"],
    "spasticity": ["HP:0001257"],
    "ataxia": ["HP:0001251"],
    "dysarthria": ["HP:0001260"],
    "dystonia": ["HP:0001332"],
    "gaze palsy": ["HP:0000511"],
    "hearing": ["HP:0000365"],
    "vision": ["HP:0000505"],
    "hernia": ["HP:0000776"],
    "kyphosis": ["HP:0002808"], "scoliosis": ["HP:0002650"],
    "beaking": ["HP:0003312"],
    "jaundice": ["HP:0000952"],
    "failure to thrive": ["HP:0001508"],
    "hypotonia": ["HP:0001252"],
    "cherry red": ["HP:0010729"],
    "foam cell": ["HP:0004333"], "gaucher cell": ["HP:0004333"],
}


def text_to_hpo(text, label_index):
    """Map a free-text phenotype description to HPO ids."""
    t = (text or "").lower()
    found = {}
    for phrase, ids in SYNONYMS.items():
        if phrase in t:
            for i in ids:
                found[i] = SYMPTOM_LABELS.get(i, phrase)
    # also try direct label matches from the knowledge table
    for hpo, label in label_index.items():
        lab = label.lower()
        if len(lab) > 6 and lab in t:
            found[hpo] = label
    return found


def build_payload(row, label_index, with_labs=False):
    sex = row.get("sex") or "unknown"
    age = row.get("age_years") or ""
    sx = {}

    if row.get("hpo_present"):
        for hid in row["hpo_present"].split(";"):
            if hid.startswith("HP:"):
                sx[hid] = SYMPTOM_LABELS.get(hid, hid)
    if row.get("phenotype_text"):
        sx.update(text_to_hpo(row["phenotype_text"], label_index))

    payload = {
        "patient": {"age_years": float(age) if age else None, "sex": sex},
        "symptoms": [{"hpo_id": h, "label": l, "present": True, "severity": 2}
                     for h, l in sx.items()],
        "labs": {"enzymes": [], "biomarkers": []},
        "genetics": {"findings": []},
    }

    if with_labs:
        # Only usable where we can express activity as percent of normal.
        # The India cohort reports absolute nmol/h/mg against lab-specific
        # ranges we do not have, so this run uses genetics only.
        if row.get("gene") and row.get("variants"):
            payload["genetics"]["findings"] = [{
                "gene": row["gene"].split("|")[0],
                "variant": row["variants"].split(";")[0],
                "zygosity": row.get("zygosity") or "",
                "classification": "pathogenic",
            }]
    return payload, len(sx)


def main():
    rows = list(csv.DictReader(open(f"{DATA}/real_test_set.csv")))
    kb = {}
    for r in csv.DictReader(open(f"{DATA}/knowledge_table.csv")):
        if r["category"] == "symptom":
            kb[r["hpo_id"]] = r["symptom"]

    for mode, with_labs in [("SYMPTOMS ONLY", False), ("SYMPTOMS + GENETICS", True)]:
        print(f"\n{'='*66}\n{mode}\n{'='*66}")
        results, skipped = [], 0
        for r in rows:
            payload, n_sx = build_payload(r, kb, with_labs)
            if n_sx == 0:
                skipped += 1
                continue
            out = predict(payload)
            ranked = [p["disease"] for p in out["predictions"]]
            truth = r["disease"]
            results.append({
                "id": r["patient_id"], "truth": truth, "n_sx": n_sx,
                "top1": ranked[0], "rank": ranked.index(truth) + 1,
                "abs": out["predictions"][0]["absolute_risk"],
                "band": out["risk_level"],
            })

        if not results:
            print("no scoreable patients")
            continue

        n = len(results)
        top1 = sum(1 for x in results if x["rank"] == 1)
        top3 = sum(1 for x in results if x["rank"] <= 3)
        print(f"scoreable: {n}/{len(rows)}   (skipped {skipped}: no mappable symptoms)")
        print(f"top-1 accuracy: {top1}/{n} = {100*top1/n:.1f}%")
        print(f"top-3 accuracy: {top3}/{n} = {100*top3/n:.1f}%")

        print(f"\n{'disease':<18}{'n':>3}{'top1':>6}{'top3':>6}   note")
        for d in DISEASES:
            sub = [x for x in results if x["truth"] == d]
            if not sub:
                continue
            t1 = sum(1 for x in sub if x["rank"] == 1)
            t3 = sum(1 for x in sub if x["rank"] <= 3)
            note = "TOO FEW TO INTERPRET" if len(sub) < 5 else ""
            print(f"{d:<18}{len(sub):>3}{t1:>6}{t3:>6}   {note}")

        misses = [x for x in results if x["rank"] > 1]
        if misses:
            print(f"\nmisranked ({len(misses)}):")
            for x in misses[:10]:
                print(f"  {x['id']:<8} true={x['truth']:<16} predicted={x['top1']:<16} "
                      f"rank={x['rank']} sx={x['n_sx']}")


if __name__ == "__main__":
    main()
