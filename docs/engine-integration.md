# Engine integration: contract mismatches

Engine 0.3.0 was connected to the Node backend on 2026-11-15. This is everything that didn't match what the backend and doctor dashboard expected, and what was done about each item. Items marked **Team decision** change Section 3 and need sign-off.

## How it is wired

- The engine runs on `127.0.0.1:8000` only. It isn't reachable from the LAN, and Vite proxies only `/api/*`, to Node.
- Node's `POST /api/predict` and `POST /api/punnett` proxy to the engine's `/predict` and `/punnett`.
- Every engine response is checked against Section 3.1/3.2 in `backend/src/services/engineContract.js` before it is stored or returned. A non-conforming response is a `502 engine_contract_violation` listing the failing field paths. A case can't enter DOCTOR_REVIEW on a non-conforming response.
- Role filtering is unchanged: the prediction blocks are stripped for every non-doctor token.

## Fixed in the engine (contract violations)

| # | Mismatch | Effect before the fix | Fix |
|---|---|---|---|
| 1 | Disease key `mps1`; the contract and fixtures use `mps_i` | MPS I bar and card keyed differently from the fixtures | `api.py` translates to `mps_i` at the API boundary. Internal names unchanged, so `weights.py` and `validate_real.py` are unaffected. |
| 2 | `factors` held only the **top** disease's rules | Differential cards #2 and #3 showed "No scoring rule fired" | `score.py` returns every fired rule for every disease, ordered by disease rank, then by points. `category_scores` is still the top disease only. |
| 3 | Enzyme supplied as `{value, unit}` was counted as **supplied** in `confidence` but scored 0 | The spec's own clear-Gaucher example came out **LOW (28.4%)** with confidence claiming enzymes were present | `assess_confidence` counts an assay as supplied only if it carries the field the rules read. A bare value now shows up in `missing_inputs`. |
| 4 | Enzyme analyte `GLA` (contract, lab form) vs engine `alpha_Gal_A`; biomarker `urinary_GAGs` vs `urinary_GAG` | Fabry enzyme never matched | Aliases in `api.py` |

## Team decision: the request contract has no field the engine can score labs from

The engine's enzyme and biomarker rules read `pct_of_normal` and `fold_uln`. Section 3.1 sends only `value` + `unit`, and `data/` has no cited reference ranges to convert one into the other. Converting would mean inventing clinical numbers (Section 11 rule 1). So under the frozen contract, **enzyme and biomarker results never contribute to the score**.

**Proposed (implemented as optional, backward compatible):**

```json
{ "analyte": "GBA", "value": 0.8, "unit": "nmol/h/mL", "assay": "DBS", "pct_of_normal": 6 }
{ "analyte": "lyso_Gb1", "value": 210.0, "unit": "ng/mL", "fold_uln": 23 }
```

The lab computes these against its own reference interval, which Section 6.2 already requires it to display. The backend accepts and stores both fields, and the seed and demo patients use them. If the team rejects this, remove the two fields from `backend/src/routes/schemas.js` and `models/Case.js`, and the engine needs another source of reference ranges.

## Reported, not changed

| # | Item | Notes |
|---|---|---|
| 5 | **Symptom weights are very small for classic findings.** Severe splenomegaly + hepatomegaly + thrombocytopenia + anaemia score 4.9 of 30 for Gaucher. | The specificity discount (`build_weights.py`) plus per-disease scaling to the 12 rarest findings. Without genetics or labs, a typical Gaucher presentation can't leave LOW. These are cited weights owned by Track B, so they are left for Track B to review. |
| 6 | `predictions` ranked by `absolute_risk`; Section 3.2 says `relative_probability` is "used only for ranking" | Same order in every case tested, because softmax follows raw score. They can differ when two diseases have different maximum scores (NPC's is 90). Ranking by absolute risk keeps the band tied to the #1 disease, so it may be the better rule. The spec should say which. |
| 7 | `confidence.missing_inputs` vocabulary: `enzyme_assay`, `detailed_symptoms` vs the fixtures' `enzymes` | Section 3 doesn't define the values. The dashboard shows unknown keys verbatim. The fixtures should follow the engine's words once agreed. |
| 8 | `recommendations.confirmatory_tests[].priority` is `urgent`/`high`/`routine`/`consider`; the fixtures use `high`/`medium` | Not defined by Section 3. Unknown values render with neutral styling. |
| 9 | Chitotriosidase has no engine rule | The ambiguous demo case's only biomarker is unscored and now appears under missing biomarkers. |
| 10 | Engine runs on Python 3.9 here; the spec says 3.11 | Works on 3.9. Pin 3.11 in Docker. |
| 11 | `build_weights.py` and `validate_real.py` hard-code `/home/claude/lsd/data` | They won't run from this repo until the paths are made relative. |

## Fixed in our own fixtures

The Fabry fixture and demo patient used `HP:0001009` for acroparesthesia. That ID is *Telangiectasia*. Corrected to `HP:0003401`.

## Live results for the demo patients

Captured through `POST /api/predict` as a doctor (`fixtures/live/`):

| Patient | Fixture | Live engine |
|---|---|---|
| A: Gaucher, no genetics (Section 3.1 example) | HIGH 68.3% | MODERATE 46.1% (no genetics, small symptom weights) |
| B: Fabry heterozygous female | MODERATE 42.3% | MODERATE 38.7% |
| C: ambiguous | MODERATE 31.8% (NPC) | LOW 2.3% (NPC) |
| D: healthy control | LOW, max 18.2% relative | LOW, all 0% absolute, 16.7% relative |
| Seeded clear Gaucher (homozygous GBA1, Section 10) | — | **HIGH 73.0%, Gaucher #1** |

To view the dashboard on live output: `npx vite-node scripts/capture-live-fixtures.js` in `frontend/`, then `VITE_ENGINE_OUTPUT=live npm run dev`.
