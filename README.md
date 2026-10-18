# KebunSah

**A phone check that tells Malaysian oil-palm smallholders whether their land documents are ready for the EU Deforestation Regulation (EUDR), and what is still missing.**

Built for the Google Cloud AI Builder Cup 2026, track *Sustainability & Social Impact*.

- **Live prototype:** https://kebunsah.web.app (open it on a phone)
- **Demo access (phone app):** on the sign-in page, open **"Demo access for judges"**. No real SMS is sent; the code for every test number is `123456`.
- **Cooperative dashboard (computer):** https://kebunsah.web.app/coop/login, with email `koperasi@kebunsah.demo` and password `Koperasi-Demo-2026` (the same box on that page fills it in). It is a separate sign-in from the phone app.

| Test number | Role |
| --- | --- |
| `+60 10-000 0011` | Smallholder, plots mostly green |
| `+60 10-000 0012` | Smallholder, yellow plots |
| `+60 10-000 0013` | Smallholder, red plots |
| `+60 10-000 0001` | Field officer (picks a member, adds land for them) |

All data in the demo is synthetic. The 200 sample plots are flagged `isSynthetic`, their photos are watermarked, and they cannot be deleted from the app.

## The problem

EUDR applies from 30 December 2026 to larger operators and from 30 June 2027 to micro and small operators. Anyone who sells palm fruit into the EU supply chain must show where it was grown: a boundary polygon for the plot, and no deforestation after 31 December 2020. Malaysia has 450,000+ palm oil smallholders. Most keep paper titles, licences and certificates, and being on an official register does not prove compliance: registers hold names, not boundaries; a land title proves ownership, not forest history; and the documents often disagree with each other.

## What KebunSah does

1. **Photograph** the land title, MPOB licence and MSPO certificate (several pages each; from camera or gallery).
2. **Draw** the land on a satellite map, walk its corners with GPS, or mark one point with a stated area (small plots).
3. **Read:** Gemini turns each photo into structured fields, each with a confidence score. Fields below 0.7 are shown beside the original photo for the user to confirm or correct.
4. **Check:** a deterministic rules engine compares area (title vs drawn), expiry dates and names across documents.
5. **Screen:** Google Earth Engine looks for forest loss after 31 December 2020 inside the plot boundary.
6. **Decide:** the plot is green, yellow or red, with a short to-do list in Bahasa Malaysia or English, a plain-language AI note and a step log showing how the check was made.
7. **Cooperatives** see all member plots on a wide-screen dashboard, filter by status and issue, and export a CSV summary or a printable dossier per plot.

Also in the app: redraw the boundary of an existing plot, add or replace documents, delete a plot, ask a question **by voice** (Malay or English), and keep working **with no signal** (drafts are saved on the phone and sent automatically later).

## How AI is used

| Job | Done by | How it is kept reliable |
| --- | --- | --- |
| Read titles, licences, certificates from photos | Gemini (multimodal, structured output) | Fixed output schema; confidence per field; low confidence goes back to the user |
| Decide pass / warn / fail | Rules engine in Python (`core/`) | Area within 10% or 0.1 ha, expiry over 90 days, name similarity 0.85; same input gives the same answer |
| Forest loss screening | Earth Engine: JRC GFC2020 V4 + Hansen global forest change v1.13 | Pixel statistics on the plot polygon; labelled preliminary |
| Plain-language note | Gemini | Written from the rule results; template text if Gemini is unavailable |
| Spoken question | Gemini (audio input) | Answers only from that plot's results; says when it cannot help |

**Gemini reads and explains; rules decide.** The pipeline is a fixed sequence of steps with Gemini and Earth Engine as tools, not an autonomous agent. Every assessment stores the model version, rules version, an input snapshot and a step log (`steps[]`), which the app shows under *How the check was made*. Results are always described as a preliminary screening, not legal advice or certification.

## Architecture

```
Phone / browser (Angular PWA, Firebase Hosting)
   │  Firebase Auth (phone code) · Google Maps JS API · offline queue (IndexedDB)
   ▼
Cloud Run: FastAPI (api/)  ── runs the check in the background (ai-worker/)
   │        verifies the Firebase ID token on every call
   ├──► Cloud Storage   photos upload straight from the phone on a signed URL
   ├──► Firestore       plots, documents, assessments (written only by the service)
   ├──► Gemini API      document reading, notes, voice  (key in Secret Manager)
   └──► Earth Engine    forest loss screening
Firestore ──► phone / dashboard   real-time updates, read-only in the browser
```

Google Cloud services in use: Cloud Run, Firebase Hosting, Firebase Authentication, Firestore, Cloud Storage, Secret Manager, Earth Engine, Gemini API, Google Maps JavaScript API.

## Repository layout

| Path | What is there |
| --- | --- |
| `web/` | Angular app: phone screens, cooperative dashboard, offline queue, voice |
| `api/` | FastAPI service (plots, documents, assess, voice, delete) |
| `ai-worker/` | The check pipeline: Gemini adapters, Earth Engine, explanations |
| `core/` | Pure Python rules (area, expiry, name, grading); no cloud imports |
| `seed/` | Generator for the 200 synthetic demo plots and watermarked sample documents |
| `contract/` | API and Firestore contracts shared by front end and back end |
| `infra/` | Cloud Run environment, Cloud Build files, Firestore and Storage rules |
| `scripts/` | Smoke tests, seed loader, end-to-end helpers |
| `docs/` | Project plan and working notes (some in Chinese, kept as internal notes) |

## Run it locally

Requirements: Python 3.11, Node 22 or newer, Java 17 or newer (for the Firebase emulators).

```bash
# Back end
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                    # add GEMINI_API_KEY (free key from aistudio.google.com)
cd web && npm ci && npm run emulators                   # Auth + Firestore emulators (separate terminal)
PYTHONPATH=core:api:ai-worker python -m uvicorn app.main:create_app_from_env --factory --port 8000

# Front end
cd web && npm start                                     # http://localhost:4200, talks to the emulators
```

Load the demo data into the emulator (with the emulator variables from `.env` set):
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 python scripts/load_seed.py --project demo-kebunsah --emulator`.
Without a Gemini key the check still completes: documents that cannot be read are flagged for officer review.

## Tests

```bash
pytest                    # 831 back-end tests (rules, API, pipeline, adapters)
cd web && npm run verify  # read-only check, production build, bundle check, 958 front-end tests
```

The full journey (sign in, add land with a two-page title, go offline, save, send on reconnect, real check, voice question, delete) was also driven in a real browser against the deployed service.

## Known limits and next steps

- The check runs inside the Cloud Run service as a background task. For volume it should move to Cloud Tasks and a separate worker.
- Gemini is called through the Gemini API (free tier limits apply). Vertex AI would give higher quotas.
- Firestore rules currently allow any signed-in user to read; role- and cooperative-scoped rules are planned.
- The satellite map needs signal. Walking the corners and single-point entry work offline.
- Forest screening uses public global datasets; results are preliminary and small plots can be misjudged.
- Not built: regulation text with citations in the explanations, e-MSPO and mill integrations, other commodities and countries.

## Data and privacy

The pipeline does not extract identity card numbers; where one is needed to match people, it is stored only as a keyed hash. Personal documents are uploaded to Cloud Storage with short-lived signed URLs. Demo data is synthetic and labelled as such.
