# LSD-CDSS Dataset

Built 2026-11-15. All clinical numbers trace to a cited source; nothing is invented.

## Files

| File | Rows | What it is |
|---|---|---|
| `knowledge_table.csv` | 714 | Symptom frequencies per disease. The generator + scoring backbone. |
| `real_test_set.csv` | 35 | Real labelled patients. **FROZEN — never train on these.** |
| `india_cohort.csv` | 31 | Sheth 2024 per-patient table (22 in scope) |
| `real_patients.csv` | 13 | Phenopacket Store cases |
| `synthetic_cohort.csv` | 6000 | Generated patients incl. healthy + confusable controls |
| `training_set.csv` | 6000 | Model-ready feature matrix (185 features) |
| `feature_spec.json` | — | Feature list, for the engine to build identical vectors |
| `prevalence_prior.json` | — | True birth prevalence, applied at inference |
| `variants/*.json` | 4992 | ClinVar pathogenic variants, for lab autocomplete |
| `baseline_rf.joblib` | — | Baseline RandomForest |

## Sources

- **HPO** `phenotype.hpoa` v2026-09-02 — symptom frequencies (incl. 4,357 Orphanet annotations)
- **ClinVar** — pathogenic + likely pathogenic variants, 8 genes
- **Phenopacket Store** v0.1.27 — real cases curated from publications
- **Sheth et al. 2024**, JIMD Reports — 31 adult Indian LSD patients
- **Newborn screening**: Illinois (219,793), NY (65,605), Italy 8-year — prevalence
- **Italy NBS** IJNS 10:00003 — IDUA normal 1.9–15 µmol/L/h vs affected 0.12–0.22

## Decisions worth defending in the report

1. **Beta(1,1) shrinkage on raw frequency counts.** A `1/1` observation from a
   single case report would otherwise read as 100% and outrank large-cohort
   bands. Now 1/1 → 67%, 64/64 → 98%.

2. **Lab-derived HPO terms excluded from the symptom track.** 28 terms such as
   "Decreased alpha-galactosidase A activity" are *enzyme inputs*, not symptoms.
   Leaving them in makes the explainability panel circular.

3. **Two-stage symptom sampling.** A disease may have 150 annotated features but
   no real patient presents with 40. Latent features are drawn from published
   frequencies, then an observation process records 4–18 of them.

4. **Enzymes reported as a multiplex PANEL, not a single analyte.** The first
   version emitted only the disease-relevant enzyme; the model then learned
   "GBA was assayed ⇒ Gaucher" and scored 97% knowing nothing clinical. Every
   patient now gets the full panel, with only the affected enzyme low.

5. **Balanced training classes, prevalence applied as a prior at inference.**
   True prevalence gives ~11× more Fabry than NPC and the rare classes never
   get learned.

6. **Fabry females modelled as symptomatic.** Heterozygous females get residual
   enzyme (median 40% of normal vs 8% in males) and reduced severity — never
   zero. Carrier females are frequently affected.

7. **NPC has no enzyme assay.** It receives the panel and comes back normal.
   That absence is itself the diagnostic signal.

8. **Realistic missingness, not imputation.** 35% of patients have no enzyme
   result and 69% no genetics. A test not ordered is clinically informative.

## Honest limitations — state these in the report

- Real patients: Krabbe n=1, Niemann-Pick C n=1, MPS I n=3, Fabry n=4.
  **Do not quote per-disease accuracy for Krabbe or NPC.**
- Training data is synthetic. ~96% on held-out synthetic data mostly measures
  whether the model recovered the generator. The only meaningful number is
  performance on `real_test_set.csv`.
- Confusable controls are synthesised from symptom overlap, not real non-LSD
  patient records. This is the weakest part of the dataset.
- Enzyme values are percent-of-normal, not absolute units, because absolute
  values are assay- and lab-dependent.

## Rebuild

```bash
python3 scripts/build_knowledge_table.py
python3 scripts/extract_real_patients.py
python3 scripts/parse_india_cohort.py
python3 scripts/generate_cohort.py -n 6000
python3 scripts/build_features.py
python3 scripts/build_variant_lookup.py
```
