# LSD-CDSS — Build Specification

**Project:** Secure AI-Based Clinical Decision Support System for Early Detection of Lysosomal Storage Diseases
**Team:** 5 people, B.Tech ECE final year, DCRUST Murthal
**Read this whole file before writing any code.**

---

## 0. How to use this document

| Track | Owner | Builds |
|---|---|---|
| A | hardware owner | ESP32 firmware + serial protocol |
| B | dataset owner | Knowledge table, scoring engine, ML model |
| **C+D** | **one developer** | **Entire software stack — backend, all 3 dashboards** |

**The thing that keeps these from blocking each other is Section 3, the API contract.** It is frozen. The full UI is built against mock fixtures before the scoring engine exists; when the real engine lands, nothing in the UI changes. Likewise the lab dashboard is built against a replayed serial stream before the firmware is finished.

**Do not change Section 3 without telling the whole team.** Everything else is negotiable.

### What is already decided and must not be re-invented

- The 6 diseases and their genes (Section 1)
- The API request/response shapes (Section 3)
- Risk band thresholds (Section 4.3)

### What is NOT yours to invent

Scoring weights, enzyme reference ranges, biomarker cutoffs and symptom frequencies are being derived from published sources (HPO/Orphanet frequency bands, the NP-C Suspicion Index, Gaucher DS3, published biomarker papers). **Do not hardcode made-up numbers.** Until the real table arrives, import from `engine/weights.py`, which ships with clearly-labelled placeholder values. Every number in the final system must be traceable to a citation.

---

## 1. Scope

### The 6 diseases

| # | Disease | Gene(s) | Enzyme | Key biomarker | Inheritance |
|---|---|---|---|---|---|
| 1 | Gaucher | GBA1 | Glucocerebrosidase | Lyso-Gb1 | Autosomal recessive |
| 2 | Fabry | GLA | α-galactosidase A | Lyso-Gb3 | X-linked |
| 3 | Pompe | GAA | Acid α-glucosidase | CK (non-specific) | Autosomal recessive |
| 4 | MPS I (Hurler) | IDUA | α-L-iduronidase | Urinary GAGs | Autosomal recessive |
| 5 | Niemann-Pick C | NPC1, NPC2 | *(no simple enzyme assay)* | Oxysterols, lyso-SM-509 | Autosomal recessive |
| 6 | Krabbe | GALC | Galactosylceramidase | Psychosine | Autosomal recessive |

**Two things to get right:**

1. **Niemann-Pick C has no enzyme assay.** It is diagnosed on NPC1/NPC2 genetics plus biomarkers. Do not build an enzyme input for it. (SMPD1 / Niemann-Pick A/B is a different disease and is *not* in scope, though we hold its data as a possible substitute.)
2. **Fabry is X-linked and women are affected.** Carrier females are frequently symptomatic. Scoring must give heterozygous females a real score, not zero. Never gate Fabry behind "male only".

### Out of scope

No other LSDs. No treatment dosing. No prescriptions. This is a **screening triage aid**, not a diagnostic device.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│  ESP32  →  USB serial  →  LAB workstation browser   │  Track A
│  MAX30102 · AD8232 · DS18B20 · MPU6050              │
│  (sensors attached to patient during lab visit)     │
└──────────────────────┬──────────────────────────────┘
                       │ JSON lines, 115200 baud
┌──────────────────────▼──────────────────────────────┐
│  React 18 + Tailwind                                │  Track D
│  3 role dashboards:  PATIENT · LAB · DOCTOR         │
└──────────────────────┬──────────────────────────────┘
                       │ REST + JWT
┌──────────────────────▼──────────────────────────────┐
│  Node 20 + Express  —  auth, patients, reports      │  Track C
│  MongoDB + Mongoose                                 │
└──────────────────────┬──────────────────────────────┘
                       │ internal HTTP, never exposed
┌──────────────────────▼──────────────────────────────┐
│  Python 3.9+ + FastAPI  —  scoring engine + model   │  Track B
└─────────────────────────────────────────────────────┘
```

**Why two backends:** Node owns auth, persistence and the browser-facing API. Python owns scoring and ML. The Python service is never reachable from the browser — Node proxies to it on an internal port. This is also a security talking point for the report.

### Ports (dev)

| Service | Port |
|---|---|
| React (Vite) | 5173 |
| Node/Express | 4000 |
| Python/FastAPI | 8000 |
| MongoDB | 27017 |

---

## 3. THE API CONTRACT — FROZEN

### 3.1 `POST /api/predict`

The single most important endpoint. Node receives this from the browser, forwards to Python, returns the result.

**Request:**

```json
{
  "patient": {
    "age_years": 7.5,
    "sex": "male",
    "consanguinity": false,
    "ethnicity": "south_asian",
    "family_history": {
      "affected_relative": true,
      "relationship": "sibling"
    }
  },
  "symptoms": [
    { "hpo_id": "HP:0001744", "label": "Splenomegaly", "present": true,  "severity": 3 },
    { "hpo_id": "HP:0002240", "label": "Hepatomegaly",  "present": true,  "severity": 2 },
    { "hpo_id": "HP:0001250", "label": "Seizure",       "present": false, "severity": 0 }
  ],
  "labs": {
    "enzymes": [
      { "analyte": "GBA", "value": 0.8, "unit": "nmol/h/mL", "assay": "DBS",
        "reference_low": 4.5, "reference_high": 20.0 }
    ],
    "biomarkers": [
      { "analyte": "lyso_Gb1", "value": 210.0, "unit": "ng/mL",
        "reference_high": 9.0 }
    ],
    "routine": {
      "hemoglobin_g_dl": 9.1,
      "platelets_10e9_l": 95
    }
  },
  "genetics": {
    "tested": true,
    "findings": [
      { "gene": "GBA1", "variant": "c.1226A>G", "zygosity": "homozygous",
        "classification": "pathogenic" }
    ],
    "parents": {
      "mother_genotype": "carrier",
      "father_genotype": "carrier"
    }
  },
  "vitals": {
    "source": "device",
    "heart_rate_bpm": 102,
    "spo2_pct": 95,
    "temperature_c": 37.1,
    "respiratory_rate_bpm": 24,
    "ecg": { "rhythm": "sinus", "qrs_ms": 96, "arrhythmia_flag": false },
    "activity": { "tremor_index": 0.12, "mobility_score": 0.74 }
  }
}
```

**Every field except `patient.age_years` and `patient.sex` is optional.** The engine must degrade gracefully — a patient with symptoms only and no labs still gets a scored result, with lower confidence.

**Response:**

```json
{
  "request_id": "a3f9...",
  "generated_at": "2026-11-15T10:32:00Z",

  "predictions": [
    {
      "disease": "gaucher",
      "display_name": "Gaucher disease",
      "raw_score": 82,
      "max_possible_score": 120,
      "absolute_risk": 0.683,
      "relative_probability": 0.71,
      "rank": 1
    },
    { "disease": "niemann_pick_c", "display_name": "Niemann-Pick disease type C",
      "raw_score": 31, "max_possible_score": 110,
      "absolute_risk": 0.282, "relative_probability": 0.14, "rank": 2 }
  ],

  "risk_level": "HIGH",
  "risk_basis": "absolute_risk",
  "confidence": {
    "level": "moderate",
    "missing_inputs": ["genetics"],
    "note": "No genetic testing supplied; score rests on enzyme and symptom evidence."
  },

  "factors": [
    { "category": "enzyme",   "feature": "GBA",          "label": "GBA critically low",
      "value": "0.8 nmol/h/mL", "points": 40, "direction": "increases",
      "disease": "gaucher", "citation": "ref:gba_range_01" },
    { "category": "symptom",  "feature": "HP:0001744",   "label": "Severe splenomegaly",
      "value": "severity 3",    "points": 20, "direction": "increases",
      "disease": "gaucher", "citation": "ref:hpo_freq_gaucher" }
  ],

  "category_scores": {
    "enzyme": 40, "genetic": 0, "symptom": 32, "biomarker": 10, "vitals": 0
  },

  "inheritance": {
    "applicable": true,
    "mode": "autosomal_recessive",
    "punnett": { "affected_pct": 25.0, "carrier_pct": 50.0, "unaffected_pct": 25.0 },
    "note": "Both parents reported as carriers."
  },

  "recommendations": {
    "confirmatory_tests": [
      { "test": "GBA1 sequencing", "priority": "high",
        "rationale": "Confirms Gaucher where enzyme activity is low." }
    ],
    "treatment_pathways": [
      { "name": "Enzyme Replacement Therapy (ERT)", "stage": "post-confirmation" }
    ],
    "referral": "Refer to a medical geneticist or metabolic specialist."
  },

  "model": {
    "engine_version": "0.3.0",
    "mode": "rule_based",
    "weights_version": "2026-11-15"
  },

  "disclaimer": "This output is a screening aid, not a diagnosis. All results must be reviewed by a qualified clinician and confirmed by laboratory testing."
}
```

### 3.1a Lab values must carry their reference range

A bare `value` + `unit` cannot be scored. Absolute enzyme activity is
assay- and laboratory-specific: 0.8 nmol/h/mL is profoundly low on one platform
and unremarkable on another. The engine will not guess, because inventing a
reference range would put an uncited clinical number into the scoring path.

So every enzyme and biomarker result carries its own reference interval, exactly
as a real laboratory report does. The lab dashboard captures this alongside the
value, from the assay's own documentation.

Accepted forms, in order of preference:

| Fields supplied | Engine behaviour |
|---|---|
| `pct_of_normal` (enzymes) / `fold_uln` (biomarkers) | used directly |
| `value` + `reference_mean` | percent computed |
| `value` + `reference_low` + `reference_high` | percent against the midpoint |
| `value` + `reference_high` only | percent against the upper limit |
| `value` alone | **not scored**, and listed in `confidence.missing_inputs` |

A result that cannot be interpreted is never silently scored as zero while
confidence still claims it was supplied.

### 3.1b Canonical names

One spelling per analyte across contract, engine and UI. The engine accepts
common synonyms and normalises, but these are the canonical keys:

| Kind | Canonical keys |
|---|---|
| Disease | `gaucher` `fabry` `pompe` `mps1` `niemann_pick_c` `krabbe` |
| Enzyme | `GBA` `alpha_Gal_A` `GAA` `IDUA` `GALC` |
| Biomarker | `lyso_Gb1` `lyso_Gb3` `CK` `urinary_GAG` `psychosine` `lyso_SM_509` `chitotriosidase` `oxysterols` |

Note `mps1`, not `mps_i`. Note `alpha_Gal_A` is the enzyme; `GLA` is the gene.

### 3.2 Field rules the engine MUST obey

- `predictions` always contains **all 6 diseases**, sorted by `rank`. Never omit low scorers — the UI shows a full bar chart.
- **`rank` is assigned by `absolute_risk`, descending.** Not by relative probability. The two orderings almost always agree, but absolute risk is the clinical quantity and is the tie-breaker of record.
- `absolute_risk` = `raw_score / max_possible_score`, range 0–1. **This drives `risk_level`.**
- `relative_probability` = temperature-scaled softmax across the 6 raw scores, summing to 1.0. **Used only for ranking and the probability chart.** Never for the risk band.
- `factors` lists every rule that fired, **for every disease, not only the top-ranked one**. Differential cards #2 and #3 need their own factors. Each entry carries `disease`, so the UI filters by it. This array *is* the explainability panel — rendered directly, no extra computation.
- `category_scores` describes the **top-ranked disease only**: the radar chart compares evidence categories for the leading hypothesis.
- `category_scores` has exactly 5 keys, always present, for the radar chart.
- `disclaimer` is non-empty on every response and must be displayed.

**Why two risk numbers:** softmax always sums to 100%, so a healthy patient would still show one disease at 60%+ and be wrongly flagged HIGH. Absolute risk fixes that. Do not collapse these into one number.

### 3.3 Other endpoints

```
POST   /api/auth/login          → { token, user: { id, name, role } }
POST   /api/auth/register       → admin only
GET    /api/auth/me             → current user

POST   /api/patients            → create
GET    /api/patients            → list (paginated, scoped by role)
GET    /api/patients/:id        → detail
PATCH  /api/patients/:id        → update

POST   /api/cases               → patient creates a case (DRAFT)
GET    /api/cases               → worklist, filtered by role + state
GET    /api/cases/:id           → detail, role-filtered payload
PATCH  /api/cases/:id/symptoms  → patient only
PATCH  /api/cases/:id/vitals    → lab only (device session summary + ECG segment)
PATCH  /api/cases/:id/labs      → lab only
POST   /api/cases/:id/transition→ { to_state } validated against Section 6.0
POST   /api/cases/:id/release   → doctor releases results to patient

POST   /api/predict             → Section 3.1
POST   /api/punnett             → { mode, mother, father } → probabilities
GET    /api/reference/symptoms  → HPO symptom list for the form autocomplete
GET    /api/reference/diseases  → the 6 diseases + metadata

POST   /api/reports             → persist a prediction as a report
GET    /api/reports/:id         → fetch
GET    /api/reports/:id/pdf     → download
```

### 3.4 Mock-first rule

Track C ships `/api/predict` returning a **hardcoded valid response** on day one. Track D builds the entire UI against it. Track B replaces the stub later. Nobody waits.

Put sample responses in `fixtures/` — at minimum: a clear Gaucher case, a Fabry female, an ambiguous case, and a healthy patient.

---

## 4. Track B — scoring engine

### 4.1 Structure

```
engine/
  weights.py        # all point values, ONE file, every entry cited
  reference.py      # enzyme + biomarker normal ranges, cited
  score.py          # score(payload) -> raw scores + fired factors
  normalize.py      # absolute risk, temperature softmax, risk bands
  punnett.py        # inheritance probabilities
  explain.py        # factors array + category scores
  api.py            # FastAPI app
  model/            # trained classifier (added later)
```

### 4.2 Scoring rules

Five categories. Each fired rule appends to the factors list with its points. The sum per disease is `raw_score`.

| Category | Weight ceiling | Notes |
|---|---|---|
| Enzyme | ~40 | Highest single signal where an assay exists |
| Genetic | ~35 | Pathogenic variant in the matching gene |
| Symptom | ~30 | Weighted by HPO/Orphanet frequency band × severity |
| Biomarker | ~15 | Where a validated cutoff exists |
| Vitals | ~10 | **Supporting evidence only — never diagnostic** |

Symptom weighting from frequency bands:

| Band | Suggested points |
|---|---|
| Obligate (100%) | 8 |
| Very frequent (99–80%) | 6 |
| Frequent (79–30%) | 4 |
| Occasional (29–5%) | 2 |
| Very rare (<4–1%) | 1 |

Multiply by severity (0–3) where supplied, normalised so one symptom cannot dominate.

**Fabry X-linked handling:**

| Genotype | Modifier |
|---|---|
| Hemizygous male | +15 |
| Heterozygous female | +8 |
| Homozygous female | +15 |

**Vitals must be linked to a disease, not free-floating:**
- ECG arrhythmia → Fabry, Pompe
- Low SpO2 / raised respiratory rate → Pompe
- Tremor or reduced mobility (MPU6050) → Krabbe, Pompe

### 4.3 Risk bands — frozen

Computed from `absolute_risk` of the top-ranked disease:

| Band | Range |
|---|---|
| LOW | < 0.30 |
| MODERATE | 0.30 – 0.60 |
| HIGH | 0.60 – 0.80 |
| CRITICAL | > 0.80 |

### 4.4 Softmax

Divide raw scores by temperature **T = 15** before softmax. Without this, a score of 80 vs 40 pushes the leader to ~100%, which is meaningless.

---

## 5. Track C — backend and security

"Secure" is in the project title, so this must be visible, not assumed.

- bcrypt password hashing, cost factor ≥ 12
- JWT with expiry and refresh tokens
- **Four roles: `patient`, `lab`, `doctor`, `admin`** — see Section 6
- **Role-based response filtering.** The `predictions`, `factors`, `category_scores` and `risk_level` blocks are stripped from `/api/predict` and `/api/reports/:id` responses for `patient` and `lab` tokens. Enforce in middleware, not in the UI.
- Patients can read only their own cases. Labs see only cases assigned to their facility. Doctors see cases in their worklist. Enforce with a query scope on every route.
- State transitions are validated server-side against the Section 6.0 machine — a lab token cannot move a case to `REPORTED`
- `helmet`, CORS allowlist, rate limiting on `/api/auth/*`
- **AES-256 encryption at rest for the `genetics` field** in MongoDB
- Audit log: who viewed/modified which patient, with timestamp
- Input validation with `zod` or `joi` on every route
- HTTPS in deployment
- No PII in logs, ever

**Legal basis for the report: India's DPDP Act 2023.** Not GINA — that is US law and irrelevant here.

### Mongo collections

`users` · `patients` · `cases` · `assessments` · `auditlogs`

A `case` holds its current state, state history with timestamps and actor, the patient's symptom submission, the lab's values, and a pointer to the latest `assessment`.

Store each prediction response verbatim in `assessments` so reports are reproducible even after weights change.

---

## 6. Track D — the 3 role dashboards

**The system has three kinds of user, each with their own dashboard.** This is the core product idea: a case is created by a patient, enriched by a lab, and decided by a doctor. The three dashboards are three *roles*, not three screens of one workflow.

### 6.0 The case lifecycle — frozen

Every case is a state machine. The dashboards are views onto it.

```
  [Patient]              [Lab]                      [Doctor]
  symptoms,       vitals via ESP32,            review, decide,
  history         enzymes, genetics            report
      │                  │                          │
 SUBMITTED ─────► LAB_PENDING ─────► DOCTOR_REVIEW ─────► REPORTED
      │                  │                          │
      │                  └── LAB_REJECTED           └── REFERRED
      │                      (bad sample)
      └── DRAFT
```

| State | Meaning | Who can act |
|---|---|---|
| `DRAFT` | Patient is still filling the form | Patient |
| `SUBMITTED` | Symptoms and history captured, awaiting lab | Lab |
| `LAB_PENDING` | Lab has claimed it, results being entered | Lab |
| `LAB_REJECTED` | Sample unusable, returned for recollection | Lab, Patient |
| `DOCTOR_REVIEW` | Scored, awaiting clinician decision | Doctor |
| `REPORTED` | Doctor signed off, report generated | Doctor |
| `REFERRED` | Escalated to a metabolic specialist | Doctor |

**Scoring runs automatically on entry to `DOCTOR_REVIEW`**, and re-runs whenever lab data changes. A case can be scored with symptoms alone (lower confidence) if the doctor requests early review.

### 6.1 Patient dashboard

**Purpose:** capture what only the patient knows, and track progress.

- Registration and profile: demographics, consanguinity, ethnicity, family history
- Symptom questionnaire: HPO-backed, but **plain language labels, not HPO jargon** — "enlarged belly or spleen", not "Splenomegaly HP:0001744". Map to HPO IDs behind the scenes.
- Present / absent / don't-know for each; severity slider 0–3 where present
- Case status tracker showing the lifecycle above in friendly words ("Your samples are with the lab")
- Past reports, once the doctor has released them

**Critical rule — patients do not see raw risk scores.** No gauge, no 6-disease bar chart, no probabilities on this dashboard. A rare, incurable, progressive disease probability shown to a patient without a clinician present is a real harm. The patient sees only what the doctor has explicitly released, and only after `REPORTED`. Make this a deliberate, documented design decision in the report — examiners will mark it well.

### 6.2 Lab dashboard

**Purpose:** enter objective measurements. Nothing diagnostic.

- Worklist: cases in `SUBMITTED`, claimable, sortable by date and urgency
- **Live vitals capture — the hardware lives here.** "Connect device" → WebSerial → ESP32 → streaming HR, SpO2, temperature, ECG trace, activity. The technician attaches the sensors to the patient during their lab visit and records a session against the open case.
  - Connection state must be explicit: disconnected / connecting / streaming / error
  - Show the live ECG trace and numerics while recording
  - "Start recording" / "Stop and save" → stores a summary (median HR, median SpO2, temperature, arrhythmia flag, tremor index, mobility score) plus the raw ECG segment against the case
  - Technician can discard and re-record a bad session
- Enzyme entry: analyte, value, unit, assay type (DBS / leukocyte / fibroblast), reference range shown alongside
- Biomarker entry: lyso-Gb1, lyso-Gb3, psychosine, oxysterols, chitotriosidase
- Routine bloods: haemoglobin, platelets, CK
- Genetics entry: gene, variant (HGVS), zygosity, classification — with **autocomplete from the ClinVar variant tables** so technicians pick known variants rather than free-typing
- Sample rejection with reason → `LAB_REJECTED`
- Submit → `DOCTOR_REVIEW`, triggers scoring

**The lab dashboard shows no predictions at all.** Lab staff enter values and move on. This keeps the measurement unbiased, and it's a point worth making in the report.

### 6.3 Doctor dashboard

**Purpose:** the full decision surface. This is where the CDSS actually lives.

**Worklist:** cases in `DOCTOR_REVIEW`, sorted by risk band, CRITICAL first.

**Case detail view, all on one screen:**
- Animated risk gauge (Framer Motion), coloured by band
- Horizontal bar chart, all 6 diseases by `absolute_risk`
- Top-3 differential cards, each with its headline factor
- Confidence panel: which inputs were missing, how that limits the result
- **Factor table** rendered straight from `factors[]` — category, finding, value, points, direction, citation
- Radar chart from `category_scores`, the 5 axes
- Punnett square visual from `inheritance`
- Confirmatory test recommendations
- Treatment pathway (ERT / SRT / transplant), clearly marked post-confirmation
- Patient's raw submitted symptoms and the lab's raw values, both inspectable
- Actions: **Generate report** (PDF) · **Refer to specialist** · **Request more tests** (sends back to `LAB_PENDING`) · **Release results to patient**

### 6.4 Non-negotiable UI rules

1. The medical disclaimer appears on the doctor dashboard and in every PDF. Visible text, not a tooltip.
2. Never display a disease name alone without its risk percentage and the word "screening".
3. Vitals are labelled "supporting evidence", never presented as diagnostic.
4. Where `confidence.missing_inputs` is non-empty, say so prominently.
5. **Risk scores render only for `doctor` role.** Enforce this server-side as well as in the UI — the prediction block must be stripped from API responses for patient and lab tokens. A hidden `<div>` is not access control.

---

## 7. Track A — hardware

### Wiring

| Component | Connection | Note |
|---|---|---|
| MAX30102 | I2C — SDA GPIO21, SCL GPIO22 | addr 0x57 |
| MPU6050 | same I2C bus | addr 0x68, no clash |
| DS18B20 | any GPIO | needs 4.7 kΩ pull-up |
| AD8232 | **GPIO34 or GPIO36 (ADC1)** | ADC2 fails when WiFi is on |

### Serial protocol — frozen

One JSON object per line, newline-terminated, 115200 baud, ~10 Hz for numerics:

```json
{"t":1731650000,"hr":78,"spo2":97,"temp":36.8,"rr":16,"accel":{"x":0.01,"y":0.02,"z":0.98}}
```

ECG samples stream separately at 250 Hz in batches:

```json
{"t":1731650000,"ecg":[512,514,530,...]}
```

### Browser side

- WebSerial works only in **Chrome/Edge**, only on localhost or HTTPS
- QRS detection in JS: band-pass → differentiate → square → moving-window integrate → threshold (simplified Pan-Tompkins)
- Validate against the BIDMC PhysioNet dataset and report a measured beat-detection accuracy

### Degradation

If no device connects, the app must work fully without vitals. Vitals are worth ≤10 points. Never block a prediction on hardware.

---

## 8. Repo layout

```
lsd-cdss/
  frontend/        React + Vite + Tailwind
  backend/         Node + Express
  engine/          Python + FastAPI
  firmware/        Arduino/ESP32
  fixtures/        mock API responses
  data/            dataset + knowledge table (Track B)
  docs/            this spec, API docs, report drafts
  docker-compose.yml
```

Single repo, feature branches per track, PRs to `main`. Anyone can run the whole stack with `docker-compose up`.

---

## 9. Build order — solo developer

The whole software stack is being built by one person. Hardware firmware is a separate owner. So this is sequenced by **risk and demo value**, not parallelism: build the hard, visible thing first, while there is still time to fix it.

### Phase 0 — first session
1. Scaffold the repo per Section 8
2. Copy this spec into `docs/`
3. `fixtures/` with 4 sample responses matching Section 3.1
4. Express on :4000, `POST /api/predict` returning the Gaucher fixture
5. React + Vite + Tailwind on :5173, fetches it, renders raw JSON

**Checkpoint: the contract works end to end.** Everything after this builds against fixtures, so the UI never waits on the scoring engine.

### Phase 1 — backend spine
- Auth, 4 roles, JWT
- Mongo schemas including `cases`
- Case state machine with server-side transition validation
- Role-based response filtering (Section 5)

Everything depends on this. Don't skip ahead.

### Phase 2 — DOCTOR dashboard first
Build Section 6.3 against fixtures, completely: gauge, 6-disease bar chart, factor table, radar chart, Punnett square, treatment pathway, PDF export.

**Why first:** it is the hardest screen, the one the viva demo centres on, and the one that proves the project's thesis. Patient and lab dashboards are ordinary forms — if time runs short at the end, rushing a form is survivable; rushing this is not.

### Phase 3 — lab dashboard
Section 6.2: worklist, vitals capture via WebSerial, enzyme/biomarker/genetics entry, sample rejection.

Hardware integration lands here. If the firmware isn't ready, build against a fake serial stream that replays recorded JSON lines — do not block.

### Phase 4 — patient dashboard
Section 6.1: registration, plain-language symptom questionnaire, status tracker. The simplest of the three.

### Phase 5 — real engine
Swap fixtures for the live scoring engine. Nothing in the UI should change — if it does, the contract was violated somewhere.

### Phase 6 — model + metrics
Trained classifier alongside the rule engine. Accuracy, precision, recall, F1, confusion matrix, ROC compared against the NP-C Suspicion Index's published AUC of 0.964.

### Phase 7 — report, paper, demo video, viva prep

### If time runs out — cut in this order
1. Patient dashboard → replace with a seeded demo patient
2. PDF export → screenshot the doctor dashboard instead
3. Trained ML model → rule engine alone still works, just reframe the "AI" claim honestly as knowledge-based
4. Live hardware → replay a recorded session

**Never cut:** the doctor dashboard, the explainability panel, or the healthy-control test case.

---

## 10. Demo patients

Keep four saved profiles so the viva demo never depends on live typing:

1. **Clear Gaucher** — low GBA, splenomegaly, anaemia, thrombocytopenia, homozygous GBA1
2. **Fabry male** — hemizygous GLA, acroparesthesia, corneal clouding, proteinuria
3. **Fabry female** — heterozygous, milder, *must still score meaningfully*
4. **Healthy control** — must come out LOW, with no disease above ~20%

Profile 4 is the one examiners will ask for. A system that flags everyone is useless.

---

## 11. Rules for whoever writes the code

1. **Never invent a clinical number.** Weights, cutoffs and ranges come from the cited knowledge table. Placeholders must be obviously labelled `PLACEHOLDER_`.
2. **Never change the Section 3 contract silently.**
3. Every clinical constant carries a `citation` key.
4. No patient data in logs or error messages.
5. The disclaimer ships in every response and every rendered output.
6. Degrade gracefully — missing labs, missing genetics, missing device must all still produce a result.
7. Write the test for the healthy control early, and keep it passing.
