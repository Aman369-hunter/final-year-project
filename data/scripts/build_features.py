#!/usr/bin/env python3
"""Turn the synthetic cohort into a model-ready feature matrix, and train a
baseline classifier as a sanity check.

Feature design follows the API contract in the spec: everything the engine
receives is a feature, nothing it does not receive is a feature. Missing values
are encoded explicitly rather than imputed, because missingness is itself
clinically informative (a test not ordered is a real signal).
"""
import csv, json, sys
import numpy as np
import pandas as pd
from collections import Counter

DATA = "/home/claude/lsd/data"
CLASSES = ["healthy", "non_lsd", "gaucher", "fabry", "pompe",
           "mps1", "niemann_pick_c", "krabbe"]


def top_symptoms(k=120):
    """The k most informative HPO terms across the 6 diseases."""
    kb = pd.read_csv(f"{DATA}/knowledge_table.csv")
    kb = kb[(kb.category == "symptom") & kb.probability.notna()]
    # rank by peak frequency in any disease, so hallmark signs are kept
    peak = kb.groupby("hpo_id").probability.max().sort_values(ascending=False)
    return list(peak.head(k).index)


def build(df, sym_ids):
    X = pd.DataFrame(index=df.index)

    X["age_years"] = pd.to_numeric(df.age_years, errors="coerce").fillna(-1)
    X["sex_male"] = (df.sex == "male").astype(int)
    X["family_history"] = pd.to_numeric(df.family_history, errors="coerce").fillna(0)
    X["consanguinity"] = pd.to_numeric(df.consanguinity, errors="coerce").fillna(0)
    X["n_symptoms"] = pd.to_numeric(df.n_symptoms, errors="coerce").fillna(0)

    # --- enzyme panel: one value column per analyte -------------------------
    # The analyte VALUES are features. Which analyte was ordered is deliberately
    # not a feature: in the real workflow a multiplex panel is run, and encoding
    # the choice of test leaks the clinician's prior suspicion into the model.
    ENZ = ["GBA", "alpha_Gal_A", "GAA", "IDUA", "GALC"]
    enz_vals = {}
    for a in ENZ:
        v = pd.to_numeric(df[f"enz_{a}"], errors="coerce")
        enz_vals[a] = v
        X[f"enz_{a}_pct"] = v.fillna(-1)
        X[f"enz_{a}_measured"] = v.notna().astype(int)
        X[f"enz_{a}_low"] = ((v < 30) & v.notna()).astype(int)
    enz_df = pd.DataFrame(enz_vals)
    X["enz_panel_n"] = enz_df.notna().sum(axis=1)
    X["enz_min_pct"] = enz_df.min(axis=1).fillna(-1)
    X["enz_any_low"] = (enz_df < 30).any(axis=1).astype(int)
    X["enz_n_low"] = (enz_df < 30).sum(axis=1)

    # --- biomarker panel ----------------------------------------------------
    BIO = ["lyso_Gb1", "lyso_Gb3", "CK", "urinary_GAG", "psychosine", "lyso_SM_509"]
    bio_vals = {}
    for b in BIO:
        v = pd.to_numeric(df[f"bio_{b}"], errors="coerce")
        bio_vals[b] = v
        X[f"bio_{b}_fold"] = v.fillna(-1)
        X[f"bio_{b}_measured"] = v.notna().astype(int)
        X[f"bio_{b}_high"] = ((v > 2) & v.notna()).astype(int)
    bio_df = pd.DataFrame(bio_vals)
    X["bio_panel_n"] = bio_df.notna().sum(axis=1)
    X["bio_max_fold"] = bio_df.max(axis=1).fillna(-1)
    X["bio_any_high"] = (bio_df > 2).any(axis=1).astype(int)

    # --- genetics -----------------------------------------------------------
    X["genetics_done"] = (df.gene.fillna("") != "").astype(int)
    for g in ["GBA1", "GLA", "GAA", "IDUA", "NPC1", "NPC2", "GALC"]:
        X[f"gene_{g}"] = (df.gene == g).astype(int)
    for z in ["homozygous", "compound heterozygous", "hemizygous", "heterozygous"]:
        X[f"zyg_{z.replace(' ', '_')}"] = (df.zygosity == z).astype(int)

    # --- vitals (supporting evidence only) ----------------------------------
    for col, default in [("hr_bpm", -1), ("spo2_pct", -1), ("temp_c", -1),
                         ("resp_rate", -1), ("tremor_index", -1), ("mobility_score", -1)]:
        v = pd.to_numeric(df[col], errors="coerce")
        X[col] = v.fillna(default)
    X["vitals_measured"] = (pd.to_numeric(df.hr_bpm, errors="coerce").notna()).astype(int)
    X["arrhythmia"] = pd.to_numeric(df.arrhythmia, errors="coerce").fillna(0)

    # --- symptoms as presence/severity --------------------------------------
    parsed = df.symptoms.fillna("").apply(
        lambda s: {kv.split(":")[0]: int(kv.split(":")[1])
                   for kv in s.split(";") if ":" in kv})
    for hid in sym_ids:
        X[f"sx_{hid.replace(':', '_')}"] = parsed.apply(lambda d: d.get(hid, 0))

    return X


def main():
    df = pd.read_csv(f"{DATA}/synthetic_cohort.csv", dtype=str)
    sym_ids = top_symptoms(120)
    X = build(df, sym_ids)
    y = df.label

    X.assign(label=y).to_csv(f"{DATA}/training_set.csv", index=False)
    json.dump({"symptom_features": sym_ids, "columns": list(X.columns)},
              open(f"{DATA}/feature_spec.json", "w"), indent=2)

    print(f"feature matrix: {X.shape[0]} patients x {X.shape[1]} features")
    print(f"  -> {DATA}/training_set.csv")
    print(f"  -> {DATA}/feature_spec.json\n")

    # ---- baseline model, honest evaluation ---------------------------------
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, confusion_matrix

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25,
                                          stratify=y, random_state=42)
    clf = RandomForestClassifier(n_estimators=400, min_samples_leaf=2,
                                 class_weight="balanced", random_state=42, n_jobs=-1)
    clf.fit(Xtr, ytr)
    pred = clf.predict(Xte)

    print("=== held-out SYNTHETIC test performance ===")
    print("(this number is NOT evidence the system works on real patients)\n")
    print(classification_report(yte, pred, digits=3, zero_division=0))

    labs = sorted(y.unique())
    cm = confusion_matrix(yte, pred, labels=labs)
    print("confusion matrix (rows=true, cols=pred)")
    print("           " + "".join(f"{l[:7]:>9}" for l in labs))
    for l, row in zip(labs, cm):
        print(f"{l[:10]:<11}" + "".join(f"{v:>9}" for v in row))

    imp = sorted(zip(X.columns, clf.feature_importances_), key=lambda t: -t[1])
    print("\ntop 12 features by importance:")
    for n, v in imp[:12]:
        print(f"  {v:.4f}  {n}")

    import joblib
    joblib.dump(clf, f"{DATA}/baseline_rf.joblib")
    print(f"\nmodel -> {DATA}/baseline_rf.joblib")


if __name__ == "__main__":
    main()
