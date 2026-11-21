# fixtures/ — mock `/api/predict` responses

Each file is a complete response in the frozen Section 3.1 shape. Track D builds the UI against these; Track C serves them until the engine is live.

| File | Case | risk_level | Top disease (absolute_risk) |
|---|---|---|---|
| `predict.gaucher.json` | Clear Gaucher (mirrors the 3.1 example, genetics missing) | HIGH | Gaucher 0.683 |
| `predict.fabry_female.json` | Heterozygous Fabry female, all inputs supplied | MODERATE | Fabry 0.423 |
| `predict.ambiguous.json` | Symptoms + chitotriosidase only; NPC vs Gaucher close | MODERATE | NPC 0.318 |
| `predict.healthy.json` | Healthy control | LOW | Pompe 0.015, no disease above 0.19 relative |

**The clinical numbers are mock values, not evidence.** Points, ranges and cutoffs are illustrative; every citation is `ref:PLACEHOLDER_*` and `weights_version` is `PLACEHOLDER_*`. Do not reuse them in `engine/weights.py`.

The derived fields are internally consistent with Section 3.2, so the UI can trust them:

- `raw_score` = sum of that disease's `factors[].points`
- `absolute_risk` = `raw_score / max_possible_score` (3 dp)
- `relative_probability` = softmax(raw / 15), sums to 1.0
- `risk_level` from the top disease's `absolute_risk` (Section 4.3 bands)
- `category_scores` = the top-ranked disease's factors, summed by category

When `inheritance.applicable` is `false`, `punnett` is `null`.
