# ReachInbox Task Checklist

## Phase 1 — Foundation
- [x] Initialize monorepo structure
- [x] Create frontend React + Vite + TypeScript
- [x] Create backend Express + TypeScript
- [x] Configure Tailwind CSS
- [x] Configure Docker Compose
- [x] Start PostgreSQL, Redis, and Elasticsearch
- [x] Add environment validation
- [x] Add backend health endpoint
- [x] Verify frontend and backend run

## Phase 2 — Database and API
- [x] Configure Prisma
- [x] Create database models
- [x] Add migrations
- [x] Implement scheduling API
- [x] Validate recipients and schedule inputs
- [x] Add duplicate-recipient validation

## Phase 3 — Queue and Email Worker
- [x] Configure BullMQ
- [x] Create separate worker process
- [x] Implement delayed email jobs
- [x] Configure Ethereal SMTP
- [x] Send test emails
- [x] Update email statuses
- [x] Configure retry behavior

## Phase 4 — Reliability
- [x] Implement deterministic job IDs
- [x] Prevent duplicate processing
- [x] Recover missing jobs after restart
- [x] Verify Redis persistence
- [x] Handle graceful shutdown
- [x] Document SMTP delivery limitations

## Phase 5 — Rate Limiting
- [x] Configure worker concurrency
- [x] Implement minimum delay between sends
- [x] Implement shared hourly sender limit
- [x] Reschedule jobs when limit is reached
- [x] Test with multiple workers

## Phase 6 — Slack Integration
- [x] Implement Slack OAuth
- [x] Store Slack connection securely
- [x] Send rate-limit notifications
- [x] Handle disconnected Slack accounts
- [x] Prevent duplicate notifications

## Phase 7 — Search and Queue Monitoring
- [x] Configure Elasticsearch
- [x] Index email records
- [x] Implement email search API
- [x] Configure Bull Board
- [x] Protect Bull Board access

## Phase 8 — Google Authentication
- [x] Implement Google OAuth code path
- [x] Create user records
- [x] Add authenticated session logic
- [x] Add logout
- [x] Protect API routes
- [x] Verify runtime environment variables are loaded from the repo-root .env
- [x] Verify callback URL is generated correctly in the live backend route
- [x] Confirm Google login succeeds after consent in the browser
- [x] Verify Google token exchange, profile retrieval, JWT/session creation, frontend auth state, and protected route behavior
- [x] Verify OAuth and auth error handling
- [x] Verify logout invalidates the session

## Phase 9 — Frontend Dashboard
- [x] Build login page
- [x] Build dashboard layout
- [x] Build Scheduled emails tab
- [x] Build Sent emails tab
- [x] Add email search
- [x] Add profile and logout
- [x] Add loading, empty, and error states

## Phase 10 — Compose Email
- [x] Build compose form
- [x] Add sender selection
- [x] Add subject and body
- [x] Import CSV recipients
- [x] Validate recipient emails
- [x] Configure start time
- [x] Configure send delay
- [x] Configure hourly limit
- [x] Submit schedule to backend

## Phase 11 — Testing
- [x] Test authentication (authenticated API route returned the live user profile; unauthenticated access is rejected)
- [x] Test email scheduling (HTTP 201 from `/api/emails/schedule` and a real database record was created)
- [x] Test Ethereal delivery (real `messageId` and `previewUrl` returned from the app SMTP transport)
- [x] Test worker restart (startup reconciliation re-enqueued missing jobs; duplicate queue entries were prevented)
- [x] Test rate limits (Redis-backed limiter denied the second send and correctly handled concurrent reservations)
- [x] Test Slack notification (VERIFIED 2026-11-05: Slack OAuth completed via browser, SlackConnection saved to PostgreSQL with teamId T0CF2GJMSBF and slackUserId U0CF9N445Q9, sendRateLimitSlackNotification() called with real credentials and returned true, message delivered to ReachInbox Testing workspace, Redis dedupe key confirmed and cleaned up)
- [x] Test Elasticsearch search (VERIFIED: the client has been downgraded to the compatible 8.x series and a real search against the running Elasticsearch 8.15.0 cluster succeeded)
- [x] Test multiple workers (Redis atomic limiter handled concurrent reservations correctly)
- [x] Test frontend and backend builds
- [x] Confirm browser Google OAuth flow (VERIFIED/COMPLETE 2026-11-05: user manually opened the ReachInbox login page, selected Continue with Google, signed in using the existing Google account, and returned successfully to the ReachInbox dashboard)

## Reference-Inspired UI Refresh
- [x] Redesign existing Google login and email dashboard in a restrained hand-drawn style
- [x] Redesign compose experience while preserving sender, recipient, CSV, and scheduling behavior
- [x] Verify frontend production build and application TypeScript sources
- [x] Preserve Google auth and existing API behavior while extending the Slack and email-list routes

## Assignment Requirement Follow-up
- [x] Add authenticated Slack connect, status, and disconnect controls to the dashboard
- [x] Return from Slack OAuth callback to the frontend with success or error feedback
- [x] Include failed deliveries in the Sent delivery-history view
- [x] Add route tests for authenticated Slack integration and failed email listing

## Phase 12 — Submission
- [x] Complete README with setup, configuration, architecture, feature map, and documented trade-offs (2026-11-06)
- [x] Verify .env.example (2026-11-06: contains development placeholders; real .env was not read)
- [x] Review repository for secret exposure (2026-11-06: no tracked files or commits; real .env is ignored; no credential-like values found in reviewed project files)
- [x] Run final tests and builds (2026-11-06: backend 38/38 tests, frontend 3/3 tests, frontend/backend builds, and backend lint passed; frontend lint still fails on TS5097 in src/lib/compose.test.ts)
- [ ] Record demo video (maximum 5 minutes)
- [ ] Grant GitHub repository access
- [ ] Submit assignment
