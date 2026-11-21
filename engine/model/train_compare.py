#!/usr/bin/env python3
"""Phase 6 — ML model comparison arm.

Trains RandomForest and XGBoost on the synthetic feature matrix, evaluates them
honestly (5-fold CV mean+/-std, held-out confusion matrices, per-class metrics),
runs SHAP, and puts all three systems — the rule engine, RF and XGBoost — on the
SAME held-out set. The rule engine is additionally scored on the 35 real
patients in real_test_set.csv.

Outputs land in engine/model/:  *.png  +  metrics.json

Honesty rules, baked in (see data/README.md):
  * Held-out SYNTHETIC accuracy measures whether a model recovered the data
    generator, NOT real-world performance. Labelled as such everywhere.
  * Per-disease REAL metrics for Krabbe and Niemann-Pick C (n=1 each) are never
    quoted; they are withheld with an explicit reason.
"""
import json
import os
import sys

import _omp  # noqa: F401  (side-effect import)
_omp.ensure_openmp()

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
import xgboost as xgb
import shap

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.normpath(os.path.join(ENGINE, "..", "data"))
OUT = HERE
sys.path.insert(0, ENGINE)

from score import predict, DISEASES  # the rule engine (6 LSD classes)
import validate_real as vr           # reuse the real-patient payload builder

RANDOM_STATE = 42
CLASSES = ["healthy", "non_lsd", "gaucher", "fabry", "pompe", "mps1", "niemann_pick_c", "krabbe"]
# Rare in the REAL test set (n=1): never quote per-disease real metrics for these.
REAL_NG = {"krabbe", "niemann_pick_c"}

DISPLAY = {
    "healthy": "Healthy", "non_lsd": "Non-LSD control", "gaucher": "Gaucher",
    "fabry": "Fabry", "pompe": "Pompe", "mps1": "MPS I",
    "niemann_pick_c": "Niemann-Pick C", "krabbe": "Krabbe",
}


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def load_data():
    train = pd.read_csv(os.path.join(DATA, "training_set.csv"))
    y = train["label"].values
    X = train.drop(columns=["label"])
    # The raw cohort is row-aligned with the feature matrix (build_features.py
    # writes it index=False in the same order). We need it to feed the rule
    # engine, which consumes raw payloads rather than the feature vector.
    raw = pd.read_csv(os.path.join(DATA, "synthetic_cohort.csv"), dtype=str)
    assert len(raw) == len(X), "cohort and feature matrix are not row-aligned"
    return X, y, raw


# ---------------------------------------------------------------------------
# Rule engine on a synthetic row -> payload
# ---------------------------------------------------------------------------
ENZ = ["GBA", "alpha_Gal_A", "GAA", "IDUA", "GALC"]
BIO = ["lyso_Gb1", "lyso_Gb3", "CK", "urinary_GAG", "psychosine", "lyso_SM_509"]


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def cohort_row_to_payload(row):
    """Build the engine's Section-3.1 payload from one synthetic_cohort row.
    Enzyme values are percent-of-normal; biomarkers are fold-of-ULN."""
    sx = []
    for kv in (row.get("symptoms") or "").split(";"):
        if ":" in kv:
            hid, _, sev = kv.rpartition(":")
            if hid.startswith("HP:"):
                sx.append({"hpo_id": hid, "label": hid, "present": True, "severity": int(sev or 0)})
    enzymes = []
    for a in ENZ:
        v = _num(row.get(f"enz_{a}"))
        if v is not None:
            enzymes.append({"analyte": a, "value": v, "unit": "pct", "assay": "DBS", "pct_of_normal": v})
    biomarkers = []
    for b in BIO:
        v = _num(row.get(f"bio_{b}"))
        if v is not None:
            biomarkers.append({"analyte": b, "value": v, "unit": "fold", "fold_uln": v})
    genetics = {"findings": []}
    if row.get("gene"):
        genetics["findings"].append({
            "gene": row["gene"], "variant": row.get("variant") or "n/a",
            "zygosity": row.get("zygosity") or "", "classification": row.get("variant_classification") or "pathogenic",
        })
    return {
        "patient": {"age_years": _num(row.get("age_years")), "sex": row.get("sex") or "unknown"},
        "symptoms": sx,
        "labs": {"enzymes": enzymes, "biomarkers": biomarkers},
        "genetics": genetics,
    }


def engine_top1(row):
    out = predict(cohort_row_to_payload(row))
    return out["predictions"][0]["disease"]


# ---------------------------------------------------------------------------
# Metrics helpers
# ---------------------------------------------------------------------------
def class_report(y_true, y_pred, labels):
    rep = classification_report(y_true, y_pred, labels=labels, digits=4,
                                output_dict=True, zero_division=0)
    return {
        "accuracy": round(accuracy_score(y_true, y_pred), 4),
        "macro": {k: round(rep["macro avg"][k], 4) for k in ("precision", "recall", "f1-score")},
        "weighted": {k: round(rep["weighted avg"][k], 4) for k in ("precision", "recall", "f1-score")},
        "per_class": {
            c: {"precision": round(rep[c]["precision"], 4), "recall": round(rep[c]["recall"], 4),
                "f1": round(rep[c]["f1-score"], 4), "support": int(rep[c]["support"])}
            for c in labels if c in rep
        },
    }


def plot_confusion(y_true, y_pred, labels, title, path):
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    fig, ax = plt.subplots(figsize=(7.5, 6.5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(labels))); ax.set_yticks(range(len(labels)))
    disp = [DISPLAY[c] for c in labels]
    ax.set_xticklabels(disp, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(disp, fontsize=8)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(title, fontsize=11)
    thresh = cm.max() / 2 if cm.max() else 0
    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=8,
                    color="white" if cm[i, j] > thresh else "black")
    fig.colorbar(im, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return cm.tolist()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("Loading data ...")
    X, y, raw = load_data()
    feat_names = list(X.columns)
    print(f"  {X.shape[0]} patients x {X.shape[1]} features, {len(set(y))} classes")

    idx = np.arange(len(X))
    Xtr, Xte, ytr, yte, itr, ite = train_test_split(
        X, y, idx, test_size=0.25, stratify=y, random_state=RANDOM_STATE)
    print(f"  held-out set: {len(Xte)} patients (shared by all three systems)")

    # XGBoost needs integer labels.
    cls_to_int = {c: i for i, c in enumerate(CLASSES)}
    int_to_cls = {i: c for c, i in cls_to_int.items()}
    ytr_i = np.array([cls_to_int[c] for c in ytr])

    models = {
        "RandomForest": RandomForestClassifier(
            n_estimators=400, min_samples_leaf=2, class_weight="balanced",
            random_state=RANDOM_STATE, n_jobs=-1),
        "XGBoost": xgb.XGBClassifier(
            n_estimators=400, max_depth=6, learning_rate=0.1, subsample=0.9,
            colsample_bytree=0.8, objective="multi:softprob",
            num_class=len(CLASSES), eval_metric="mlogloss",
            tree_method="hist", random_state=RANDOM_STATE, n_jobs=-1),
    }

    metrics = {
        "meta": {
            "n_patients": int(X.shape[0]), "n_features": int(X.shape[1]),
            "classes": CLASSES, "held_out_n": int(len(Xte)),
            "random_state": RANDOM_STATE,
            "WARNING": ("Held-out SYNTHETIC accuracy measures recovery of the data "
                        "generator, NOT real-world performance. The only real-world "
                        "signal is the rule engine on real_test_set.csv."),
        },
        "cross_validation": {}, "held_out": {}, "head_to_head": {},
        "shap": {}, "rule_engine_real": {},
    }

    # ---- 1. 5-fold stratified CV (mean +/- std), full labelled set ----------
    print("\n5-fold stratified cross-validation (synthetic) ...")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    y_int_full = np.array([cls_to_int[c] for c in y])
    for name, model in models.items():
        Xcv, ycv = (X, y) if name == "RandomForest" else (X, y_int_full)
        # n_jobs=1 across folds: the loky workers would re-import xgboost without
        # the libomp preload and crash. Each fit still multithreads internally.
        cv = cross_validate(model, Xcv, ycv, cv=skf, scoring=["accuracy", "f1_macro"], n_jobs=1)
        acc, f1m = cv["test_accuracy"], cv["test_f1_macro"]
        metrics["cross_validation"][name] = {
            "accuracy_mean": round(float(acc.mean()), 4), "accuracy_std": round(float(acc.std()), 4),
            "f1_macro_mean": round(float(f1m.mean()), 4), "f1_macro_std": round(float(f1m.std()), 4),
            "folds": 5,
        }
        print(f"  {name:<14} acc {acc.mean():.4f} +/- {acc.std():.4f}   f1_macro {f1m.mean():.4f} +/- {f1m.std():.4f}")

    # ---- 2. Fit on train split, evaluate on held-out ------------------------
    print("\nFitting on train split, evaluating on shared held-out set ...")
    fitted, heldout_pred = {}, {}
    for name, model in models.items():
        model.fit(Xtr, ytr if name == "RandomForest" else ytr_i)
        fitted[name] = model
        pred = model.predict(Xte)
        pred = pred if name == "RandomForest" else np.array([int_to_cls[int(p)] for p in pred])
        heldout_pred[name] = pred
        metrics["held_out"][name] = class_report(yte, pred, CLASSES)
        cm_path = os.path.join(OUT, f"{'rf' if name=='RandomForest' else 'xgb'}_confusion.png")
        metrics["held_out"][name]["confusion_matrix"] = {
            "labels": CLASSES,
            "matrix": plot_confusion(yte, pred, CLASSES,
                                     f"{name} — held-out synthetic confusion", cm_path),
        }
        print(f"  {name:<14} held-out acc {metrics['held_out'][name]['accuracy']:.4f}  "
              f"macro-F1 {metrics['held_out'][name]['macro']['f1-score']:.4f}  -> {os.path.basename(cm_path)}")

    # CV comparison bar
    _plot_cv(metrics["cross_validation"], os.path.join(OUT, "cv_comparison.png"))

    # ---- 3. SHAP on the trained XGBoost ------------------------------------
    print("\nSHAP (TreeExplainer on XGBoost) ...")
    shap_meta = run_shap(fitted["XGBoost"], Xte, feat_names, cls_to_int)
    metrics["shap"] = shap_meta

    # ---- 4. Head-to-head: engine vs RF vs XGB on the SAME held-out set ------
    print("\nHead-to-head on the shared held-out set ...")
    metrics["head_to_head"] = head_to_head(raw, ite, yte, heldout_pred, fitted, Xte)
    _plot_head_to_head(metrics["head_to_head"], os.path.join(OUT, "head_to_head.png"))

    # ---- 5. Rule engine on the 35 REAL patients ----------------------------
    print("\nRule engine on real_test_set.csv (symptoms only) ...")
    metrics["rule_engine_real"] = engine_on_real()

    with open(os.path.join(OUT, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"\nWrote {os.path.join(OUT, 'metrics.json')}")
    print("PNGs:", ", ".join(sorted(p for p in os.listdir(OUT) if p.endswith(".png"))))


def _plot_cv(cv, path):
    names = list(cv)
    fig, ax = plt.subplots(figsize=(6, 4.2))
    xs = np.arange(len(names)); w = 0.35
    ax.bar(xs - w/2, [cv[n]["accuracy_mean"] for n in names], w,
           yerr=[cv[n]["accuracy_std"] for n in names], capsize=5, label="Accuracy")
    ax.bar(xs + w/2, [cv[n]["f1_macro_mean"] for n in names], w,
           yerr=[cv[n]["f1_macro_std"] for n in names], capsize=5, label="Macro-F1")
    ax.set_xticks(xs); ax.set_xticklabels(names)
    ax.set_ylim(0, 1.05); ax.set_ylabel("Score")
    ax.set_title("5-fold CV (synthetic) — mean +/- std")
    ax.legend(); fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def run_shap(model, Xte, feat_names, cls_to_int):
    n = min(600, len(Xte))
    Xs = Xte.iloc[:n]
    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(Xs)
    # Normalise to list-per-class of (n_samples, n_features).
    if isinstance(sv, list):
        per_class = sv
    else:
        sv = np.asarray(sv)
        per_class = [sv[:, :, k] for k in range(sv.shape[2])] if sv.ndim == 3 else [sv]

    # Global beeswarm-style summary (bar, mean |SHAP| per class).
    summary_path = os.path.join(OUT, "shap_summary.png")
    plt.figure()
    shap.summary_plot(per_class, Xs, feature_names=feat_names, plot_type="bar",
                      class_names=[c for c, _ in sorted(cls_to_int.items(), key=lambda t: t[1])],
                      show=False, max_display=15)
    plt.title("SHAP global feature importance (XGBoost)")
    plt.tight_layout(); plt.savefig(summary_path, dpi=130); plt.close()

    # Top features per DISEASE (the 6 LSDs), by mean |SHAP|.
    top_per_disease = {}
    for disease in ["gaucher", "fabry", "pompe", "mps1", "niemann_pick_c", "krabbe"]:
        k = cls_to_int[disease]
        mean_abs = np.abs(per_class[k]).mean(axis=0)
        order = np.argsort(mean_abs)[::-1][:10]
        top_per_disease[disease] = [
            {"feature": feat_names[i], "mean_abs_shap": round(float(mean_abs[i]), 5)} for i in order
        ]

    # Per-disease top-feature grid.
    grid_path = os.path.join(OUT, "shap_top_features.png")
    fig, axes = plt.subplots(2, 3, figsize=(15, 9))
    for ax, disease in zip(axes.ravel(), top_per_disease):
        items = top_per_disease[disease][:8][::-1]
        ax.barh([it["feature"] for it in items], [it["mean_abs_shap"] for it in items], color="#2563eb")
        ax.set_title(DISPLAY[disease], fontsize=10)
        ax.tick_params(axis="y", labelsize=7); ax.tick_params(axis="x", labelsize=7)
    fig.suptitle("Top SHAP features per disease (XGBoost)", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.97]); fig.savefig(grid_path, dpi=130); plt.close(fig)

    print(f"  wrote {os.path.basename(summary_path)}, {os.path.basename(grid_path)}")
    return {"summary_plot": os.path.basename(summary_path),
            "top_features_plot": os.path.basename(grid_path),
            "n_explained": int(n), "top_features_per_disease": top_per_disease}


def head_to_head(raw, test_idx, y_true, heldout_pred, fitted, Xte):
    """All three systems on the SAME held-out rows. The rule engine ranks only
    the 6 LSDs and has no 'healthy'/'non_lsd' class, so the fair common ground
    is the DISEASED subset (true label is one of the 6). On that subset we also
    restrict the ML models to the 6 disease classes for an apples-to-apples
    top-1, and report their unrestricted full-set accuracy separately."""
    y_true = np.asarray(y_true)
    diseased_mask = np.isin(y_true, DISEASES)
    dis_idx_local = np.where(diseased_mask)[0]

    # Rule engine predictions on the diseased subset.
    eng_pred = {}
    for li in dis_idx_local:
        eng_pred[li] = engine_top1(raw.iloc[int(test_idx[li])])
    eng_correct = sum(1 for li in dis_idx_local if eng_pred[li] == y_true[li])

    # ML models restricted to the 6 disease classes on the same subset.
    def restricted_top1(name):
        model = fitted[name]
        proba = model.predict_proba(Xte.iloc[dis_idx_local])
        classes = list(model.classes_) if name == "RandomForest" else CLASSES
        dcols = [classes.index(d) if name == "RandomForest" else CLASSES.index(d) for d in DISEASES]
        sub = proba[:, dcols]
        pick = [DISEASES[j] for j in sub.argmax(axis=1)]
        return sum(1 for p, t in zip(pick, y_true[dis_idx_local]) if p == t)

    n_dis = len(dis_idx_local)
    table = {
        "shared_held_out_n": int(len(y_true)),
        "diseased_subset_n": int(n_dis),
        "note": ("The rule engine outputs only the 6 LSD classes, so the common "
                 "comparison is top-1 on the diseased subset with the ML models "
                 "restricted to those 6 classes. Full-set accuracy (8 classes, "
                 "including healthy/non-LSD controls) is reported for the ML "
                 "models only, since the engine cannot label a control."),
        "rule_engine_synthetic_caveat": (
            "The rule engine scores ~1.000 here ONLY because the synthetic cohort "
            "was generated from the same knowledge_table.csv the engine scores "
            "with — this is generator recovery, i.e. the engine grading its own "
            "homework, not evidence of accuracy. The ML numbers are comparable to "
            "each other; the engine's synthetic number is NOT comparable to them. "
            "The engine's only real signal is rule_engine_real (65.6% top-1 on 32 "
            "real patients)."),
        "diseased_subset_top1_accuracy": {
            "RuleEngine": round(eng_correct / n_dis, 4),
            "RandomForest": round(restricted_top1("RandomForest") / n_dis, 4),
            "XGBoost": round(restricted_top1("XGBoost") / n_dis, 4),
        },
        "full_set_accuracy_8class": {
            "RuleEngine": None,
            "RandomForest": round(accuracy_score(y_true, heldout_pred["RandomForest"]), 4),
            "XGBoost": round(accuracy_score(y_true, heldout_pred["XGBoost"]), 4),
        },
        "full_set_macro_f1_8class": {
            "RuleEngine": None,
            "RandomForest": round(f1_score(y_true, heldout_pred["RandomForest"], average="macro"), 4),
            "XGBoost": round(f1_score(y_true, heldout_pred["XGBoost"], average="macro"), 4),
        },
    }
    d = table["diseased_subset_top1_accuracy"]
    print(f"  diseased-subset top-1 (n={n_dis}):  "
          f"engine {d['RuleEngine']:.3f} | RF {d['RandomForest']:.3f} | XGB {d['XGBoost']:.3f}")
    return table


def _plot_head_to_head(h2h, path):
    sysnames = ["RuleEngine", "RandomForest", "XGBoost"]
    vals = [h2h["diseased_subset_top1_accuracy"][s] for s in sysnames]
    fig, ax = plt.subplots(figsize=(6, 4.2))
    bars = ax.bar(sysnames, vals, color=["#64748b", "#0ea5e9", "#2563eb"])
    ax.set_ylim(0, 1.05); ax.set_ylabel("Top-1 accuracy")
    ax.set_title(f"Head-to-head on diseased held-out subset (n={h2h['diseased_subset_n']})")
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width()/2, v + 0.01, f"{v:.3f}", ha="center", fontsize=9)
    fig.text(0.5, 0.005, "Synthetic data — measures generator recovery, not real-world accuracy",
             ha="center", fontsize=7, color="#b45309")
    fig.tight_layout(rect=[0, 0.03, 1, 1]); fig.savefig(path, dpi=130); plt.close(fig)


def engine_on_real():
    """Replicate validate_real's symptoms-only evaluation, structured as JSON.
    Per-disease real metrics for krabbe/niemann_pick_c (n=1) are withheld."""
    import csv
    rows = list(csv.DictReader(open(os.path.join(DATA, "real_test_set.csv"))))
    kb = {}
    for r in csv.DictReader(open(os.path.join(DATA, "knowledge_table.csv"))):
        if r["category"] == "symptom":
            kb[r["hpo_id"]] = r["symptom"]

    results, skipped = [], 0
    for r in rows:
        payload, n_sx = vr.build_payload(r, kb, with_labs=False)
        if n_sx == 0:
            skipped += 1
            continue
        out = predict(payload)
        ranked = [p["disease"] for p in out["predictions"]]
        truth = r["disease"]
        results.append({"truth": truth, "rank": ranked.index(truth) + 1 if truth in ranked else 99})

    n = len(results)
    top1 = sum(1 for x in results if x["rank"] == 1)
    top3 = sum(1 for x in results if x["rank"] <= 3)
    per_disease = {}
    for d in DISEASES:
        sub = [x for x in results if x["truth"] == d]
        if not sub:
            continue
        if d in REAL_NG:
            per_disease[d] = {"n": len(sub), "withheld": True,
                              "reason": "n=1 real patient — per-disease accuracy is not interpretable"}
        else:
            per_disease[d] = {
                "n": len(sub),
                "top1": sum(1 for x in sub if x["rank"] == 1),
                "top3": sum(1 for x in sub if x["rank"] <= 3),
                "caveat": "small n, interpret with caution" if len(sub) < 5 else None,
            }
    print(f"  scoreable {n}/{len(rows)} | top-1 {top1}/{n} = {100*top1/n:.1f}% | top-3 {top3}/{n} = {100*top3/n:.1f}%")
    return {
        "mode": "symptoms_only",
        "scoreable": n, "total": len(rows), "skipped_no_mappable_symptoms": skipped,
        "top1_accuracy": round(top1 / n, 4), "top3_accuracy": round(top3 / n, 4),
        "per_disease": per_disease,
        "note": ("This is the only real-world number in this report. 'Scoreable' "
                 "excludes patients whose free-text phenotype did not map to HPO. "
                 "Krabbe and Niemann-Pick C are withheld (n=1 each)."),
    }


if __name__ == "__main__":
    main()
