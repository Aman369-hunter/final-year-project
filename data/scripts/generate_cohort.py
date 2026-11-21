#!/usr/bin/env python3
"""Synthetic LSD cohort generator.

Samples patients from the published frequency table, with healthy controls and
"confusable" non-LSD controls whose presentations overlap the LSDs. Enzyme
activity is modelled as PERCENT OF LABORATORY NORMAL MEAN rather than absolute
units, because absolute values are assay- and lab-dependent while percent-of-mean
is how newborn screening programmes actually set thresholds.

Anchors:
  IDUA  normal 1.9-15 umol/L/h, affected 0.12-0.22  (Italy NBS, IJNS 10:00003)
  GBA   affected 1.2-2.5 nmol/h/mg protein          (Sheth 2024, India adults)
  Missouri NBS uses percent-of-daily-mean cutoffs   (IJNS 11:00048)
"""
import csv, json, random, argparse, math
from collections import defaultdict, Counter

DATA = "/home/claude/lsd/data"

DISEASES = ["gaucher", "fabry", "pompe", "mps1", "niemann_pick_c", "krabbe"]

META = {
    "gaucher":        {"gene": "GBA1", "inh": "AR", "enzyme": "GBA",
                       "biomarker": "lyso_Gb1", "onset_yrs": (0.5, 40)},
    "fabry":          {"gene": "GLA", "inh": "XL", "enzyme": "alpha_Gal_A",
                       "biomarker": "lyso_Gb3", "onset_yrs": (5, 50)},
    "pompe":          {"gene": "GAA", "inh": "AR", "enzyme": "GAA",
                       "biomarker": "CK", "onset_yrs": (0.1, 45)},
    "mps1":           {"gene": "IDUA", "inh": "AR", "enzyme": "IDUA",
                       "biomarker": "urinary_GAG", "onset_yrs": (0.5, 10)},
    "niemann_pick_c": {"gene": "NPC1", "inh": "AR", "enzyme": None,
                       "biomarker": "lyso_SM_509", "onset_yrs": (0.1, 35)},
    "krabbe":         {"gene": "GALC", "inh": "AR", "enzyme": "GALC",
                       "biomarker": "psychosine", "onset_yrs": (0.1, 5)},
}

# True birth prevalence from newborn screening (Illinois 219,793 newborns;
# NY 65,605; Italy 8-year). Recorded for use as a PRIOR AT INFERENCE TIME.
#
# We deliberately do NOT sample the training cohort at these rates. Doing so
# gives ~11x more Fabry than Niemann-Pick C, and the classifier never learns the
# rare classes. Standard practice is to train on balanced classes and apply the
# prevalence prior at scoring time, which keeps both the learning signal and the
# epidemiology honest.
PREVALENCE = {
    "gaucher": 1 / 15539, "fabry": 1 / 8454, "pompe": 1 / 21979,
    "mps1": 1 / 62154, "niemann_pick_c": 1 / 100000, "krabbe": 1 / 100000,
}

# Typical number of findings a clinician actually records. A disease may have
# 150 annotated features, but no real patient presents with 40 of them: most are
# stage-dependent, mutually exclusive, or simply never assessed at that visit.
OBSERVED_FINDINGS = (4, 18)

# Non-LSD conditions that present like LSDs. Without these the model learns
# "big spleen -> Gaucher" and flags every anaemic child in the clinic.
CONFUSABLE = {
    "thalassemia":        ["HP:0001744", "HP:0001903", "HP:0002240", "HP:0001508"],
    "leukemia":           ["HP:0001744", "HP:0001903", "HP:0001873", "HP:0002240"],
    "chronic_liver_dis":  ["HP:0002240", "HP:0001744", "HP:0000952", "HP:0001396"],
    "muscular_dystrophy": ["HP:0003324", "HP:0003236", "HP:0001324", "HP:0002355"],
    "cerebral_palsy":     ["HP:0001263", "HP:0002061", "HP:0001260", "HP:0002376"],
    "rheumatoid_arthr":   ["HP:0001369", "HP:0002829", "HP:0001387"],
    "viral_hepatitis":    ["HP:0002240", "HP:0000952", "HP:0002910"],
}

rng = random.Random()


def load_knowledge():
    """disease -> [(hpo_id, label, probability)] for symptom-category rows only."""
    kb = defaultdict(list)
    labels = {}
    with open(f"{DATA}/knowledge_table.csv") as fh:
        for r in csv.DictReader(fh):
            if r["category"] != "symptom" or not r["probability"]:
                continue
            p = float(r["probability"])
            kb[r["disease"]].append((r["hpo_id"], p))
            labels[r["hpo_id"]] = r["symptom"]
    return kb, labels


def load_variants():
    """gene -> [variant names], from the ClinVar pathogenic exports."""
    import glob, os
    out = defaultdict(list)
    base = "/mnt/user-data/uploads/Desktop/final year project dataset"
    for path in glob.glob(f"{base}/clinvar_download_*.tsv"):
        with open(path, errors="ignore") as fh:
            rd = csv.DictReader(fh, delimiter="\t")
            for row in rd:
                genes = (row.get("Gene(s)") or "").replace(" ", "")
                name = (row.get("Name") or "").strip()
                if not genes or not name:
                    continue
                for g in genes.split("|"):
                    if g:
                        out[g].append(name)
    TARGETS = {"GBA1","GBA","GLA","GAA","IDUA","NPC1","NPC2","GALC","SMPD1"}
    return {g: v[:4000] for g, v in out.items() if g in TARGETS}


# --- enzyme / biomarker models (percent of lab normal mean) -----------------

def enzyme_pct(status):
    """Enzyme activity as % of laboratory normal mean."""
    if status == "affected":
        return max(0.3, rng.lognormvariate(math.log(8), 0.55))     # ~2-25%
    if status == "carrier":
        return max(5.0, rng.gauss(52, 12))                          # ~30-75%
    if status == "pseudodeficiency":
        return max(5.0, rng.gauss(32, 8))                           # overlaps!
    return max(10.0, rng.gauss(100, 22))                            # normal


def biomarker_fold(status):
    """Biomarker as fold-change above the upper limit of normal."""
    if status == "affected":
        return rng.lognormvariate(math.log(25), 0.9)
    if status == "carrier":
        return rng.lognormvariate(math.log(1.8), 0.5)
    return rng.lognormvariate(math.log(0.6), 0.45)


def sample_symptoms(disease, kb, severity_bias, bg_rate, all_ids):
    """Sample the findings actually RECORDED for a disease patient.

    Two stages, mirroring reality:
      1. latent: which features the patient truly has, drawn from the published
         frequencies, scaled by how advanced the disease is
      2. observed: which of those a clinician records at this visit, capped to a
         realistic count and weighted so hallmark features surface first
    """
    latent = []
    for hpo, prob in kb[disease]:
        if rng.random() < prob * severity_bias:
            latent.append((hpo, prob))
    if not latent:
        latent = sorted(kb[disease], key=lambda x: -x[1])[:3]

    # More advanced disease -> more findings recorded.
    lo, hi = OBSERVED_FINDINGS
    target = int(round(rng.triangular(lo, hi, lo + (hi - lo) * severity_bias)))
    target = max(1, min(target, len(latent)))

    # Weight selection by frequency so hallmark signs appear more often than
    # incidental ones, without making the sample deterministic.
    chosen, pool = [], list(latent)
    for _ in range(target):
        if not pool:
            break
        weights = [p for _, p in pool]
        pick = rng.choices(range(len(pool)), weights=weights)[0]
        chosen.append(pool.pop(pick))

    present = {}
    for hpo, prob in chosen:
        sev = int(round(min(3, max(1, rng.gauss(1 + severity_bias * 1.6, 0.7)))))
        present[hpo] = sev

    # incidental findings unrelated to the disease
    n_bg = sum(1 for _ in range(4) if rng.random() < bg_rate)
    for hpo in rng.sample(all_ids, min(n_bg, len(all_ids))):
        present.setdefault(hpo, 1)
    return present


def make_patient(pid, kb, labels, variants, all_ids):
    roll = rng.random()
    if roll < 0.28:
        return healthy(pid, all_ids)
    if roll < 0.48:
        return confusable(pid, all_ids)
    return affected(pid, kb, variants, all_ids)


PANEL_ENZYMES = ["GBA", "alpha_Gal_A", "GAA", "IDUA", "GALC"]
PANEL_BIOMARKERS = ["lyso_Gb1", "lyso_Gb3", "CK", "urinary_GAG",
                    "psychosine", "lyso_SM_509"]


def base_row(pid, label):
    row = {
        "patient_id": pid, "label": label, "sex": rng.choice(["male", "female"]),
        "age_years": "", "symptoms": "", "n_symptoms": 0,
        "gene": "", "variant": "", "zygosity": "", "variant_classification": "",
        "family_history": 0, "consanguinity": 0,
        "hr_bpm": "", "spo2_pct": "", "temp_c": "", "resp_rate": "",
        "arrhythmia": 0, "tremor_index": "", "mobility_score": "",
    }
    # Enzyme and biomarker results are reported as a PANEL, not a single analyte.
    # Emitting only the disease-relevant analyte would leak the diagnosis through
    # which test was ordered: a classifier then learns "GBA was assayed =>
    # Gaucher" and scores ~97% while knowing nothing clinical.
    for a in PANEL_ENZYMES:
        row[f"enz_{a}"] = ""
    for b in PANEL_BIOMARKERS:
        row[f"bio_{b}"] = ""
    return row


def run_enzyme_panel(row, affected_analyte=None, status="affected", p_panel=0.82):
    """Multiplex enzyme panel: all analytes measured together, as in newborn
    screening. Only the affected enzyme is low; the rest sit in normal range."""
    if rng.random() > p_panel:
        return                                   # no lab work this visit
    # Some sites run a narrower panel.
    analytes = PANEL_ENZYMES if rng.random() < 0.75 else rng.sample(PANEL_ENZYMES, 3)
    if affected_analyte and affected_analyte not in analytes:
        analytes = analytes + [affected_analyte]
    for a in analytes:
        if a == affected_analyte:
            row[f"enz_{a}"] = round(enzyme_pct(status), 1)
        else:
            st = "pseudodeficiency" if rng.random() < 0.06 else "normal"
            row[f"enz_{a}"] = round(enzyme_pct(st), 1)


def run_biomarker_panel(row, affected_marker=None, status="affected", p_panel=0.5):
    if rng.random() > p_panel:
        return
    markers = rng.sample(PANEL_BIOMARKERS, rng.randint(2, len(PANEL_BIOMARKERS)))
    if affected_marker and affected_marker not in markers:
        markers.append(affected_marker)
    for m in markers:
        st = status if m == affected_marker else "normal"
        row[f"bio_{m}"] = round(biomarker_fold(st), 2)


def add_vitals(row, abnormal=False):
    """Vitals are supporting evidence only; they never carry a diagnosis."""
    if rng.random() < 0.25:              # device not used for this visit
        return
    row["hr_bpm"] = round(rng.gauss(88 if abnormal else 78, 12))
    row["spo2_pct"] = round(min(100, rng.gauss(95.5 if abnormal else 98, 1.6)), 1)
    row["temp_c"] = round(rng.gauss(36.9, 0.35), 1)
    row["resp_rate"] = round(rng.gauss(20 if abnormal else 16, 3))
    row["arrhythmia"] = int(rng.random() < (0.18 if abnormal else 0.03))
    row["tremor_index"] = round(abs(rng.gauss(0.22 if abnormal else 0.08, 0.07)), 3)
    row["mobility_score"] = round(min(1, max(0, rng.gauss(0.62 if abnormal else 0.88, 0.14))), 3)


def healthy(pid, all_ids):
    row = base_row(pid, "healthy")
    row["age_years"] = round(rng.uniform(0.5, 60), 1)
    sx = {}
    for hpo in rng.sample(all_ids, rng.randint(0, 3)):
        sx[hpo] = 1
    row["symptoms"] = ";".join(f"{k}:{v}" for k, v in sx.items())
    row["n_symptoms"] = len(sx)
    run_enzyme_panel(row, affected_analyte=None, p_panel=0.55)
    run_biomarker_panel(row, affected_marker=None, p_panel=0.25)
    add_vitals(row, abnormal=False)
    return row


def confusable(pid, all_ids):
    cond = rng.choice(list(CONFUSABLE))
    row = base_row(pid, "non_lsd")
    row["age_years"] = round(rng.uniform(1, 65), 1)
    sx = {}
    for hpo in CONFUSABLE[cond]:
        if rng.random() < 0.8:
            sx[hpo] = 1 + int(rng.random() * 3)
    for hpo in rng.sample(all_ids, rng.randint(0, 4)):
        sx.setdefault(hpo, 1)
    row["symptoms"] = ";".join(f"{k}:{v}" for k, v in sx.items())
    row["n_symptoms"] = len(sx)
    # Crucially: these patients get the same panel and come back NORMAL.
    run_enzyme_panel(row, affected_analyte=None, p_panel=0.70)
    run_biomarker_panel(row, affected_marker=None, p_panel=0.35)
    add_vitals(row, abnormal=True)
    row["confusable_condition"] = cond
    return row


def affected(pid, kb, variants, all_ids):
    disease = rng.choice(DISEASES)   # balanced; prevalence applied as a prior at scoring time
    meta = META[disease]
    row = base_row(pid, disease)

    lo, hi = meta["onset_yrs"]
    row["age_years"] = round(rng.uniform(lo, hi), 1)

    # Fabry is X-linked: females are heterozygous and often symptomatic but
    # typically milder, with residual enzyme activity.
    if meta["inh"] == "XL":
        if row["sex"] == "male":
            zyg, sev_bias, enz_status = "hemizygous", 1.0, "affected"
        else:
            zyg = "heterozygous"
            sev_bias = rng.uniform(0.35, 0.8)
            enz_status = rng.choices(["affected", "carrier"], weights=[0.45, 0.55])[0]
    else:
        zyg = rng.choices(["homozygous", "compound heterozygous"], weights=[0.55, 0.45])[0]
        sev_bias, enz_status = rng.uniform(0.6, 1.0), "affected"

    sx = sample_symptoms(disease, kb, sev_bias, bg_rate=0.10, all_ids=all_ids)
    row["symptoms"] = ";".join(f"{k}:{v}" for k, v in sx.items())
    row["n_symptoms"] = len(sx)

    # NPC has no diagnostic enzyme assay: it still gets the panel, and the panel
    # comes back normal. That absence of a low enzyme IS the clinical signal.
    run_enzyme_panel(row, affected_analyte=meta["enzyme"], status=enz_status)
    run_biomarker_panel(row, affected_marker=meta["biomarker"],
                        status="affected" if enz_status == "affected" else "carrier",
                        p_panel=0.55)

    # Genetics are often not done, especially in resource-limited settings.
    if rng.random() < 0.6:
        gene = meta["gene"]
        row["gene"] = gene
        pool = variants.get(gene) or variants.get(gene.rstrip("1")) or []
        if pool:
            row["variant"] = rng.choice(pool)[:120]
        row["zygosity"] = zyg
        row["variant_classification"] = rng.choices(
            ["pathogenic", "likely pathogenic"], weights=[0.72, 0.28])[0]

    row["family_history"] = int(rng.random() < 0.22)
    row["consanguinity"] = int(rng.random() < (0.30 if meta["inh"] == "AR" else 0.08))
    add_vitals(row, abnormal=(rng.random() < 0.55))
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("-o", default=f"{DATA}/synthetic_cohort.csv")
    args = ap.parse_args()
    rng.seed(args.seed)

    kb, labels = load_knowledge()
    variants = load_variants()
    all_ids = sorted(labels)

    rows = [make_patient(f"S{i:05d}", kb, labels, variants, all_ids)
            for i in range(1, args.n + 1)]

    fields = list(base_row("x", "y").keys()) + ["confusable_condition"]
    for r in rows:
        r.setdefault("confusable_condition", "")
    with open(args.o, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    c = Counter(r["label"] for r in rows)
    print(f"{'class':<20}{'n':>6}{'pct':>7}{'med sx':>8}{'min enz%':>10}")
    for k, n in c.most_common():
        sub = [r for r in rows if r["label"] == k]
        sx = sorted(r["n_symptoms"] for r in sub)
        ez = sorted(min(float(r[f"enz_{a}"]) for a in PANEL_ENZYMES if r[f"enz_{a}"])
                    for r in sub if any(r[f"enz_{a}"] for a in PANEL_ENZYMES))
        med_ez = f"{ez[len(ez)//2]:.1f}" if ez else "-"
        print(f"{k:<20}{n:>6}{100*n/len(rows):>6.1f}%{sx[len(sx)//2]:>8}{med_ez:>10}")
    print(f"\n{len(rows)} patients -> {args.o}")
    print("\nvariant pools: " + ", ".join(f"{g}={len(v)}" for g, v in sorted(variants.items())))
    with open(f"{DATA}/prevalence_prior.json", "w") as fh:
        json.dump({"source": "Illinois/NY/Italy newborn screening",
                   "note": "apply at inference; training cohort is class-balanced",
                   "birth_prevalence": PREVALENCE}, fh, indent=2)
    print(f"prior -> {DATA}/prevalence_prior.json")


if __name__ == "__main__":
    main()
