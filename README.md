# ReachInbox Email Scheduler

ReachInbox is a full-stack email scheduling assignment project. It provides a React dashboard for composing and viewing scheduled mail, an Express API, PostgreSQL as the source of truth, Redis and BullMQ for delayed jobs, and an independent worker that sends through Ethereal SMTP.

> **Delivery note:** Ethereal is a test SMTP service. It captures messages for inspection and does not deliver them to real recipient inboxes. A `SENT` status means Ethereal accepted the test message, not that a real recipient received it.

## Requirements

- Node.js 20 or newer and npm
- Docker Desktop (or compatible Docker Engine) for PostgreSQL, Redis, and Elasticsearch
- Google OAuth client credentials for sign-in
- Slack OAuth app credentials for workspace connection and rate-limit alerts
- An Ethereal test account, or allow Nodemailer to create a temporary test account

## Quick start

### 1. Configure local environment

Copy `.env.example` to the repository root as `.env`. Fill in the OAuth credentials and use a strong local `JWT_SECRET`. Keep `.env` private; it is ignored by Git. Never put secrets in frontend variables.

The backend loads the repository-root `.env` even when started from the `backend/` directory. The defaults in `.env.example` match the local Docker Compose services.

### 2. Start PostgreSQL, Redis, and Elasticsearch

```bash
npm run docker:up
```

The services use persistent Docker volumes. Redis is configured with append-only persistence.

### 3. Install dependencies and prepare the database

```bash
npm install
npm run db:generate
npm run db:migrate
```

`db:migrate` runs Prisma's development migration command. The Prisma schema and migration history are under `backend/prisma/`.

### 4. Start the frontend, API, and worker

Start these in separate terminals so the API and worker have independent lifecycles:

**Terminal 1 — frontend and API:**

```bash
npm run dev
```

This starts the Vite frontend on `http://localhost:5173` and the Express API on `http://localhost:4000`. To run only one of them, use `npm run dev:frontend` or `npm run dev:backend`.

**Terminal 2 — email worker:**

```bash
npm run dev:worker
```

The worker is required for scheduled emails to be sent. `npm run dev` does **not** start it.

### 5. Open the application

- Frontend: <http://localhost:5173>
- API health: <http://localhost:4000/health>
- Bull Board: <http://localhost:4000/admin/queues>

Bull Board requires the HTTP Basic Auth credentials configured through `BULL_BOARD_USERNAME` and `BULL_BOARD_PASSWORD`.

## Using the dashboard

1. Open `http://localhost:5173` and sign in with Google.
2. Choose **Compose email** and select a sender.
3. Enter recipient addresses or upload a CSV list. The compose form reports how many valid addresses it found and skips invalid CSV rows.
4. Enter the subject and message, then choose the start time, delay between recipients, and sender hourly limit.
5. Schedule the messages. Each recipient gets its own email record and delayed queue job.
6. Use **Scheduled** to review queued mail and **Sent** to review successful and failed attempts. The worker must be running for jobs to be processed.
7. Use the Slack panel to connect a workspace if you want rate-limit alerts.

## Environment configuration

Backend settings are read from the repository-root `.env`. `VITE_API_URL` is consumed by the frontend during its build. Defaults below are for local development; replace development secrets before using a shared or production environment.

| Variable | Purpose | Local default / notes |
|---|---|---|
| `NODE_ENV` | Runtime mode | `development` |
| `PORT` | Express API port | `4000` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_URL` | BullMQ and shared rate-limit connection | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Email search index | `http://localhost:9200` |
| `WORKER_CONCURRENCY` | Jobs processed concurrently by each worker | `1`; allowed range is 1–20 |
| `EMAIL_FROM` | SMTP From address used by the worker | `noreply@reachinbox.local` |
| `SMTP_HOST` | SMTP host | `smtp.ethereal.email` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | Use TLS immediately | `false` for the local Ethereal SMTP setup |
| `SMTP_USER`, `SMTP_PASSWORD` | Ethereal SMTP credentials | Set both for a persistent Ethereal account. If either is blank, the app creates a temporary Nodemailer test account. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in OAuth credentials | Required for real Google sign-in |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback | `http://localhost:4000/api/auth/google/callback` |
| `JWT_SECRET` | Signs the HTTP-only app session and Slack OAuth state | Replace the sample value with a long random secret |
| `FRONTEND_URL` | OAuth callback return destination | `http://localhost:5173` |
| `VITE_API_URL` | Frontend build-time API origin (public; no secrets) | `http://localhost:4000` |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack OAuth credentials | Required to connect a Slack workspace |
| `SLACK_REDIRECT_URI` | Slack OAuth callback | `http://localhost:4000/api/slack/oauth/callback` |
| `BULL_BOARD_USERNAME`, `BULL_BOARD_PASSWORD` | Bull Board HTTP Basic Auth | Set both to enable access |

The frontend reads `VITE_API_URL` at build time as the backend origin (for example, `http://localhost:4000` locally or the deployed API origin in hosting settings). It appends `/api` for API requests and uses `/health` for the service-status link. This variable is public frontend configuration, so never put secrets in it. OAuth redirect URIs must exactly match the values registered with Google and Slack.

## Ethereal SMTP setup

1. Create an Ethereal test account at <https://ethereal.email> if you want a persistent test inbox and credentials.
2. Put its SMTP username and password in `SMTP_USER` and `SMTP_PASSWORD` in the local `.env`. Keep the host, port, and secure settings aligned with the Ethereal SMTP details.
3. If both credential values are blank, the backend asks Nodemailer to create a temporary Ethereal test account when it first sends a message.
4. Schedule a message and wait for the worker. Check the dashboard's **Sent** view for a `SENT` status.

Ethereal does not send to real inboxes. The mailer can generate an Ethereal preview URL, but the current worker/dashboard does not expose that URL to the user. The project's `SENT` status records acceptance by the configured test SMTP transport.

## Google and Slack OAuth setup

Register the local callback URLs with the OAuth providers:

- Google: `http://localhost:4000/api/auth/google/callback`
- Slack: `http://localhost:4000/api/slack/oauth/callback`

Add the corresponding client IDs and secrets to `.env`. The frontend starts Google sign-in from the login screen. Once signed in, the dashboard's Slack panel can connect or disconnect the current user's Slack workspace. Slack OAuth state is signed and time-limited; connection and status endpoints use the signed-in app session. Rate-limit Slack notifications are sent by the worker when an account is connected. Slack errors are non-blocking for email processing.

Do not recreate existing OAuth apps or replace working local credentials unnecessarily. Never commit OAuth secrets, tokens, or `.env`.

## How the system works

### Scheduling and persistence

1. The authenticated client sends a validated request to `POST /api/emails/schedule`.
2. The API validates recipients and schedule fields with Zod, creates a campaign and one PostgreSQL email record per unique recipient, then queues a deterministic BullMQ job for each record.
3. BullMQ stores delayed jobs in Redis. PostgreSQL remains the source of truth for email records and statuses.
4. On worker startup, the worker reconciles scheduled PostgreSQL records with the queue and re-enqueues missing jobs. Deterministic job IDs and guarded status changes reduce duplicate processing.

There are no cron jobs. Postgres and Redis use persistent Docker volumes in the local Compose setup; Redis also has append-only persistence enabled.

### Worker concurrency, delay, and hourly limits

- `WORKER_CONCURRENCY` configures how many jobs each worker may process at a time (default `1`, maximum `20`). Multiple worker processes can share the same queue.
- Each scheduling request sets a minimum delay in minutes between recipients and an hourly limit for the chosen sender.
- A Redis Lua script coordinates each sender's last-send time and hourly bucket atomically across workers.
- When a sender cannot send yet, the job is rescheduled for the next allowed time and remains scheduled rather than being discarded.
- If 1,000 emails are scheduled near the same time, they are stored as separate records and delayed queue jobs. Worker concurrency limits parallel processing, and the shared per-sender rate limiter spreads sends over time by rescheduling excess jobs. This behavior is covered by queue and rate-limit tests; the project does not claim a 1,000-email live load test.

### Email statuses and delivery guarantees

The dashboard has **Scheduled** and **Sent** views. The Sent view includes both `SENT` and `FAILED` records. `SENT` means the SMTP transport accepted the message; `FAILED` means the worker encountered an error and marked that record failed.

BullMQ jobs are configured for up to three attempts with exponential backoff. However, the worker currently changes the database status to `FAILED` on the first send exception, and the duplicate-processing guard skips `FAILED` records. As a result, retries after a send exception are limited and should not be assumed to resend the message automatically.

Exactly-once SMTP delivery cannot be guaranteed. If SMTP accepts a message but the worker crashes before PostgreSQL records `SENT`, the system cannot know with certainty whether retrying would duplicate that external delivery. Deterministic job IDs, status guards, and retry handling reduce this risk but cannot eliminate the SMTP/database boundary.

### Search and queue monitoring

Email documents are indexed in Elasticsearch and the API exposes `GET /api/emails/search?q=...`, scoped to the authenticated user. PostgreSQL remains canonical; failed Elasticsearch indexing is queued for retry so search outages do not block email sending. The dashboard's email list search is served by the authenticated list API.

Bull Board is mounted at `/admin/queues` and protected with HTTP Basic Auth. Configure both Bull Board credentials to access it.

## Features mapped to the assignment

### Backend

- TypeScript and Express API with Zod request validation
- PostgreSQL persistence through Prisma and database migrations
- One email record per recipient; multiple sender records and sender selection
- BullMQ delayed jobs backed by Redis; no cron-based scheduling
- Separate API and worker processes; configurable worker concurrency
- Redis-backed per-sender minimum delay and hourly rate limit shared across workers
- Rate-limited jobs are rescheduled, not discarded
- Startup reconciliation, deterministic job IDs, and guarded email status transitions
- Nodemailer delivery through Ethereal SMTP
- Real Google and Slack OAuth flows; Slack notifications when limits are reached
- Elasticsearch indexing and user-scoped search endpoint
- Protected Bull Board queue monitor
- Health endpoints: `/health` and `/api/health`

### Frontend

- React, TypeScript, Vite, and Tailwind CSS
- Google sign-in, authenticated dashboard profile, and logout
- Scheduled and delivery-history views, including failed status
- Search, loading, empty, and error states
- Email composition with sender selection, CSV recipient import, recipient validation, start time, per-recipient delay, and hourly cap
- Slack connect, connection status, and disconnect controls
- Responsive screenshot-inspired hand-drawn visual style

## API quick reference

Authenticated routes use the HTTP-only Google-authenticated session cookie.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | API health |
| `GET` | `/api/auth/google/login` | Start Google sign-in |
| `GET` | `/api/auth/me` | Return the current app user |
| `POST` | `/api/auth/logout` | End the app session |
| `GET` / `POST` | `/api/senders` | List or create a sender for the signed-in user |
| `GET` | `/api/emails?status=SCHEDULED` | List scheduled messages |
| `GET` | `/api/emails?status=SENT` | List sent and failed delivery records |
| `POST` | `/api/emails/schedule` | Create recipient records and delayed jobs |
| `GET` | `/api/emails/search?q=...` | Search indexed email data in Elasticsearch |
| `GET` | `/api/slack/connect` | Start Slack OAuth for the signed-in user |
| `GET` | `/api/slack/status` | Check the signed-in user's Slack connection |
| `DELETE` | `/api/slack/disconnect` | Disconnect the signed-in user's Slack workspace |
| `GET` | `/api/slack/oauth/callback` | Slack OAuth callback |

## Build and verification commands

```bash
npm run build
npm test
npm --workspace frontend test
npm run lint
```

`npm test` runs the backend Vitest suite. The frontend also has its own test script. The repository's regular frontend lint currently reports TS5097 for the `.ts` extension import in `frontend/src/lib/compose.test.ts`; the application source has also been checked independently. Consult `TASKS.md` for recorded assignment verification evidence and current test status.

## Assumptions and trade-offs

- This is a local assignment/demo service using Ethereal, not a production bulk-mail platform. Ethereal does not deliver mail to real recipients.
- The compose form supports multiple sender records, but outbound SMTP currently uses the configured `EMAIL_FROM` value for the From header. Selecting a sender does not configure a separate SMTP credential or From identity per sender.
- Slack access tokens are stored in PostgreSQL and are not returned by the status API. Application-level encryption at rest for those tokens is not implemented.
- The API search endpoint uses Elasticsearch; the dashboard's list search uses the authenticated email-list API. PostgreSQL remains the source of truth.
- The queue and Redis limiter are designed to handle large same-time schedules by pacing and rescheduling work, but there is no claim of live testing at 1,000-message scale.
- SMTP cannot provide a strict exactly-once guarantee across a crash between remote acceptance and local status persistence.
- Send exceptions are marked `FAILED` on the first attempt; the current status guard limits later BullMQ attempts from retrying that record.
- Slack OAuth redirect handling and the dashboard controls are covered by route tests; the latest UI changes have not been re-verified against a live Slack OAuth authorization in this checkout.

## Project documents

- `TASKS.md` — implementation and verification checklist
- `PROJECT_STATE.md` — current project checkpoint and next milestone
- `DECISIONS.md` — architecture decisions and trade-offs
- `.env.example` — names, sample local defaults, and placeholders for configuration; it contains no active OAuth credentials
