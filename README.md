# LSD-CDSS

Screening triage aid for six lysosomal storage diseases. The full build spec is in [docs/LSD_CDSS_SPEC.md](docs/LSD_CDSS_SPEC.md). Read it before contributing. Section 3 (the API contract) is frozen.

```
frontend/   React 18 + Vite + Tailwind         :5173   Track D
backend/    Node 20 + Express                  :4000   Track C
engine/     Python 3.11 + FastAPI (internal)   :8000   Track B
firmware/   ESP32 / Arduino                            Track A  (replay fixture stands in)
firmware/   ESP32 / Arduino                            Track A  (not started)
fixtures/   mock /api/predict responses
data/       dataset + cited knowledge table
docs/       spec, API docs, report drafts
```

## Status: Phase 3

Doctor dashboard (fixtures) and **lab dashboard** (live backend) both built; `/api/predict` and `/api/punnett` proxy to the live engine. The lab dashboard captures ESP32 vitals (or a replay fixture when no hardware), with QRS detection in a Web Worker, and enters lab values and genetics. Details: [docs/backend-phase1.md](docs/backend-phase1.md), [docs/engine-integration.md](docs/engine-integration.md), [docs/lab-dashboard-phase3.md](docs/lab-dashboard-phase3.md).

## Run it

Requires Node 20 or newer. First time only, create `backend/.env` from `backend/.env.example` and fill in the two secrets (the file explains how), then `npm install` in `backend/` and `frontend/`.

Terminal 1, MongoDB (data kept in `backend/.data/`; skip this if you already run MongoDB on 27017):

```bash
cd backend && npm run db
```

Terminal 2, the scoring engine (internal only, bound to 127.0.0.1):

```bash
cd engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cd engine && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8000
```

Terminal 3, seed demo data (wipes the database; needs the engine running), then the API on :4000:

```bash
cd backend && npm run seed && npm run dev
```

Terminal 4, the frontend on :5173:

```bash
cd frontend && npm run dev
```

The seed creates `admin@`, `doctor@`, `lab@` and `patient@lsd.test`, all with `SEED_PASSWORD` from `backend/.env`, plus 3 cases in DRAFT, SUBMITTED and DOCTOR_REVIEW.

## Doctor dashboard (Phase 2, fixtures only)

Open http://localhost:5173/doctor. By default it runs on the four `fixtures/` responses; see docs/engine-integration.md to view live engine output instead. It uses `frontend/src/data/mockCases.js`, so it needs neither the backend nor a login. Actions change in-memory state only; "Reset demo cases" or a reload restores them. Patient and lab dashboards are not built yet.

## Lab dashboard (Phase 3, live backend)

Open http://localhost:5173/lab and sign in as `lab@lsd.test` with `SEED_PASSWORD` from `backend/.env`. Claim a `SUBMITTED` case, then:

- **Connect device** → pick *Replay fixture* (no hardware) or *ESP32 (Web Serial)*, and *Start stream*. Five live tiles animate from the stream; the heart pulses once per detected beat and the ECG sweeps with R-peak ticks. *Simulate dropout* freezes the tiles without zeroing them.
- **Record** a session → *Stop and review* → *Save to case* (stores medians + a 10 s ECG segment).
- **Enter lab values** (each enzyme/biomarker needs its reference range) and genetics (ClinVar autocomplete), then **Submit to doctor** or **Reject sample**.

Regenerate the simulated serial stream with `python3 fixtures/make-serial-replay.py`.

## Tests

```bash
cd backend && npm test
```

```bash
cd frontend && npm test
```

The frontend suite includes the QRS detector scored against the replay fixture's ground-truth beats and the serial protocol parser.

The backend tests use a throwaway in-memory MongoDB; no running database needed.
