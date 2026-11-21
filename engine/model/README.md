# Phase 6 — ML model comparison arm

Reproduce:

```bash
cd engine
.venv-ml/bin/python model/train_compare.py
```

`model/train_compare.py` trains RandomForest and XGBoost on
`data/training_set.csv` (6000 synthetic patients × 185 features, 8 classes),
evaluates them honestly, runs SHAP, puts all three systems on the **same**
held-out set, and additionally scores the rule engine on the 35 real patients in
`data/real_test_set.csv`. All outputs are written here.

> **Environment note.** XGBoost's wheel needs the OpenMP runtime (`libomp`),
> which isn't installed on this machine (no Homebrew). We ship a copy under
> `engine/.venv-ml/libomp/libomp.dylib` (extracted from the conda-forge
> `llvm-openmp` package) and `model/_omp.py` preloads it before `import xgboost`.
> No system changes, no binary patching. Cross-validation runs its folds
> serially (`n_jobs=1`) because loky worker processes would re-import xgboost
> without that preload; each fit still multithreads internally.

## Outputs

| File | What it is |
|---|---|
| `metrics.json` | Every number below, machine-readable |
| `rf_confusion.png`, `xgb_confusion.png` | Held-out (synthetic) confusion matrices |
| `cv_comparison.png` | 5-fold CV accuracy & macro-F1, mean ± std |
| `shap_summary.png` | SHAP global feature importance (XGBoost) |
| `shap_top_features.png` | Top SHAP features per disease (XGBoost) |
| `head_to_head.png` | Rule engine vs RF vs XGBoost, same held-out subset |

## Results

**5-fold stratified CV (synthetic, mean ± std)**

| Model | Accuracy | Macro-F1 |
|---|---|---|
| RandomForest | 0.9585 ± 0.0046 | 0.9625 ± 0.0045 |
| XGBoost | 0.9655 ± 0.0040 | 0.9678 ± 0.0036 |

**Held-out synthetic (1500 patients):** RF acc 0.958 / macro-F1 0.962;
XGBoost acc 0.966 / macro-F1 0.966. Per-class precision/recall/F1 and confusion
matrices are in `metrics.json` and the PNGs.

**Head-to-head on the shared held-out set.** The rule engine outputs only the 6
LSD classes (no *healthy* / *non-LSD* class), so the common ground is top-1 on
the **diseased subset** (n=774), with the ML models restricted to those 6
classes:

| System | Diseased-subset top-1 |
|---|---|
| Rule engine | 1.000 |
| RandomForest | 0.970 |
| XGBoost | 0.968 |

**Rule engine on the 35 REAL patients (symptoms only):** 32/35 scoreable,
**top-1 65.6%**, top-3 93.8%.

## Read these numbers honestly

1. **Synthetic accuracy measures generator recovery, not real-world
   performance.** The ~96% held-out numbers mostly say the models relearned the
   process that *made* the data. They are not evidence the system works on real
   patients.

2. **The rule engine's 1.000 on synthetic data is circular.** The synthetic
   cohort was generated from the same `knowledge_table.csv` the engine scores
   with — the engine is grading its own homework. The RF and XGBoost numbers are
   comparable *to each other*; the engine's synthetic number is **not**
   comparable to them. The engine's only real-world signal is the 65.6% top-1 on
   real patients.

3. **No per-disease real metrics for Krabbe or Niemann-Pick C.** There is exactly
   **1 real patient each**, so a per-disease accuracy is meaningless and is
   withheld (flagged `withheld: true` in `metrics.json`). Fabry (n=4) and MPS I
   (n=3) are reported but flagged small-n. Per-disease metrics on the *synthetic*
   held-out set are fine — every class has hundreds of examples there.

4. **SHAP is clinically coherent**, which is reassuring: Gaucher → `enz_GBA_pct`
   / `gene_GBA1`, Fabry → `enz_alpha_Gal_A_pct` / `gene_GLA`, Pompe → `enz_GAA`
   / `bio_CK_fold`, MPS I → `enz_IDUA`, Krabbe → `enz_GALC`, and Niemann-Pick C →
   `gene_NPC1` + `enz_min_pct` (NPC has no enzyme assay of its own, so a normal
   enzyme panel plus genetics carries it — exactly the dataset's design intent).
