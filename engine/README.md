# Scoring engine

Rule-based differential scoring for 6 lysosomal storage diseases.
Implements spec Section 4. Returns the Section 3.1 response contract.

## Run

```bash
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

Node proxies to this on an internal port. It is never exposed to the browser.

## Files

| File | Purpose |
|---|---|
| `build_weights.py` | Generates `weights.py` from `data/knowledge_table.csv` |
| `weights.py` | AUTO-GENERATED. Do not hand-edit. |
| `score.py` | Scoring rules + `predict(payload)` |
| `punnett.py` | Inheritance probabilities (AR and X-linked) |
| `api.py` | FastAPI service |
| `validate_real.py` | Validation against the 35 real patients |

## How symptom weights are derived

`points = base(frequency) x specificity`, where specificity is this disease's
share of the symptom's total probability mass across all six diseases.

Frequency alone is misleading. Hepatomegaly is ~90% frequent in Gaucher, but
also in Niemann-Pick C and Pompe, so observing it barely moves the differential.
Specificity discounts it to 0.63 while leaving vertical supranuclear gaze palsy
(unique to NPC) and angiokeratoma (unique to Fabry) at 1.98.

## Two risk numbers, deliberately

- `absolute_risk` = raw / max possible -> drives the risk band
- `relative_probability` = tempered softmax (T=15) -> ranks the differential only

Softmax always sums to 1.0, so a healthy patient would still show one disease at
~17% and could be banded HIGH on relative probability alone. Absolute risk
prevents that. Do not collapse these into one number.

## Validation results (35 real patients)

Symptoms only, no lab data -- the clinically meaningful test:

| Metric | Result |
|---|---|
| Top-1 accuracy | 20/32 = 62.5% |
| Top-3 accuracy | 30/32 = 93.8% |

By number of findings recorded:

| Findings | n | Top-1 | Top-3 |
|---|---|---|---|
| 2 or fewer | 14 | 57% | 86% |
| 3-4 | 11 | 45% | 100% |
| 5 or more | 7 | 100% | 100% |

**Symptoms + genetics gives 100%, and that number is not meaningful** -- a
confirmed pathogenic GBA1 variant *is* the diagnosis. It verifies the genetics
rules are wired correctly, nothing more. Do not quote it as accuracy.

Per-disease: Gaucher n=11, Pompe n=12 are interpretable. Fabry n=4, MPS I n=3,
NPC n=1, Krabbe n=1 are **too few to interpret** -- report the counts, not
percentages.

## Known limitations

- 3 of 35 patients had no mappable symptoms and were excluded
- Free-text phenotypes from the India cohort are mapped to HPO by keyword, which
  is lossy; phenopacket patients carry native HPO codes
- Enzyme rules use percent-of-normal. The India cohort reports absolute
  nmol/h/mg against lab ranges we do not have, so those values are unused
