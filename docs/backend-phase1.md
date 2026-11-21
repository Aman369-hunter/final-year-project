# Backend — Phase 1 notes (Track C)

What was built, and the decisions the rest of the team needs to know about. Items marked **Contract** touch Section 3 and need team sign-off.

## Contract additions and open questions

1. **Contract: two new auth endpoints.** `POST /api/auth/refresh` (rotates the refresh cookie, returns `{ token, user }`) and `POST /api/auth/logout` (204). `POST /api/auth/login` keeps its exact Section 3.3 shape, `{ token, user: { id, name, role } }`; the refresh token travels in an httpOnly cookie (`rt`, path `/api/auth`, SameSite=Strict), so the body is unchanged.
2. **Contract: `DOCTOR_REVIEW → LAB_PENDING`.** Section 6.3's "Request more tests" needs this edge, but the Section 6.0 diagram doesn't draw it. It is implemented as a doctor-only transition. Remove it if the team decides otherwise.
3. **Open: early review.** Section 6.0 says a doctor may request early review on symptoms alone. There is no transition for that yet (doctors can't see `SUBMITTED` cases). This needs a decision on which edge it is.
4. **Open: admin access.** Admin manages accounts only. Admin tokens get 403 on `/api/cases/*` and filtered output from `/api/predict`.
5. **`/api/predict` now needs a token.** The Phase 0 page on :5173 calls it without one, so it now shows a 401. Track D's login screen fixes that.

## Case lifecycle (Section 6.0)

| From | To | Who | Notes |
|---|---|---|---|
| DRAFT | SUBMITTED | patient | |
| SUBMITTED | LAB_PENDING | lab | lab claims; sets `assigned_lab` |
| LAB_PENDING | DOCTOR_REVIEW | lab | **scoring runs here**; assessment stored verbatim |
| LAB_PENDING | LAB_REJECTED | lab | `reason` required |
| LAB_REJECTED | SUBMITTED | lab, patient | re-collection |
| DOCTOR_REVIEW | REPORTED | doctor | |
| DOCTOR_REVIEW | REFERRED | doctor | |
| DOCTOR_REVIEW | LAB_PENDING | doctor | "Request more tests"; re-scored on return |

Everything else is rejected:
- `400 unknown_state` / `validation_failed` when the target state doesn't exist.
- `409 illegal_transition` when the edge doesn't exist.
- `403 role_not_permitted` when the edge exists but belongs to another role.
- `404` when the case is outside your scope.

Transitions are applied with a conditional update on the current state, so two concurrent requests can't both succeed. Every case response includes `allowed_transitions` for the caller's role, so the UI can show only valid buttons.

## Role scoping (Section 5)

| Role | Sees |
|---|---|
| patient | cases for their own patient record |
| lab | cases at their facility, except DRAFT |
| doctor | cases at their facility in DOCTOR_REVIEW, REPORTED or REFERRED; sorted CRITICAL first |
| admin | none |

## What each role gets from `GET /api/cases/:id`

- **patient:** state, friendly `status_label`, timeline, own symptoms, rejection reason, doctor's released note. No lab values, no assessment.
- **lab:** patient age and sex, symptoms, vitals, labs (genetics decrypted). No assessment, no risk.
- **doctor:** everything, including `assessment.response` (the verbatim Section 3.1 response) and `risk_level`.

On top of that, the `predictionFilter` middleware removes `predictions`, `factors`, `category_scores` and `risk_level` at any depth from every response unless the token is a doctor's. It is default-deny: patient, lab, admin and anonymous callers are all filtered.

## Security checklist status

| Item | Status |
|---|---|
| bcrypt cost 12 | done (`bcryptjs`, constant in `config.js`) |
| JWT expiry + refresh tokens | done: 15 min HS256 access; 7-day opaque refresh, single-use, stored as sha256 |
| 4 roles | done |
| Role-based response filtering | done (middleware + per-role payloads) |
| Query scope on every route | done (`caseScope.js`) |
| Server-side state machine | done |
| helmet, CORS allowlist, auth rate limit | done |
| AES-256 genetics at rest | done (AES-256-GCM, case id bound as AAD) |
| Audit log | done for login, case create/view/list/update/transition/release, predict; append-only through the model |
| zod on every route | done; errors report path + code, never values |
| No PII in logs | the server logs only error class names |
| HTTPS | deployment (Phase 3) |

## Not built in Phase 1

`/api/patients/*`, `/api/punnett`, `/api/reference/*`, `/api/reports/*`. Scoring is still the stub (Gaucher fixture for every case); the request sent to it is already built from the case by `buildPredictRequest`.
