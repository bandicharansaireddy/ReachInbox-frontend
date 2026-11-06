# ReachInbox Architecture Decisions

## 1. Database
PostgreSQL is the primary source of truth for users, campaigns, senders, and email statuses.

## 2. ORM
Prisma is used for database access and migrations.

## 3. Queue
BullMQ is used for email scheduling and delayed jobs.

Cron jobs are not allowed.

## 4. Redis
Redis is used for BullMQ and shared rate-limit coordination.

Redis must use persistence appropriate for the development environment.

## 5. Worker Architecture
The Express API and email worker run as separate processes.

This allows workers to run independently and supports configurable concurrency.

## 6. Email Delivery
Nodemailer with Ethereal SMTP is used for assignment email testing.

Ethereal is a test email service, not a production email provider.

## 7. Idempotency
Each recipient email has a unique database record and deterministic queue job ID.

The worker rejects duplicate processing by checking the current database status before sending and by reusing the same job ID for the same email and schedule time.

## 8. Recovery and Reconciliation
On startup, the worker reconciles PostgreSQL email records with BullMQ jobs and re-enqueues any scheduled emails whose job is missing.

This protects recovery after API restart, worker restart, or partial Redis loss without duplicating already sent records.

## 9. SMTP Limitations
SMTP delivery cannot guarantee true exactly-once delivery if the SMTP server accepts an email but the worker crashes before saving its status.

This limitation is mitigated by idempotent job IDs, guarded status transitions, and retry logic, but it cannot be eliminated completely in a distributed system. The project documents it honestly and treats PostgreSQL as the source of truth for final delivery state.

## 10. Rate Limiting
Rate limits must be shared across workers using Redis or database coordination.

The project uses a Redis Lua script to atomically coordinate each sender's last-send timestamp and the sender hourly bucket, so multiple workers never exceed the configured hourly cap or send before the minimum delay has elapsed.

Jobs are rescheduled when the limit is reached instead of being discarded, and the worker keeps PostgreSQL as the source of truth for the final state.

## 11. Search
Elasticsearch is used to index and search email records.

PostgreSQL remains the source of truth.

## 12. Integrations
Google OAuth provides application login.

Slack OAuth connects a user's Slack workspace for rate-limit notifications.

Slack failures must not prevent email scheduling or sending.

## 13. Slack Notification Design
Slack notifications are deduplicated with a Redis-backed key and are emitted only when a valid OAuth token exists for the authenticated user.

Notification sending is intentionally non-blocking, so a disconnected or unavailable Slack workspace never interrupts the queue or the email worker.

## 14. Search and Monitoring Design
Elasticsearch is treated as a searchable projection of the email data and is never considered the source of truth. PostgreSQL remains the canonical system state, while Elasticsearch receives upserts whenever an email is scheduled, sent, failed, or rescheduled.

If Elasticsearch is unavailable, email scheduling and processing continue normally. The indexing failure is written to a Redis retry queue and retried on startup or on the next background cycle so the search layer can recover without blocking delivery.

## 15. Dashboard Security
Bull Board is mounted behind HTTP basic auth and requires explicit credentials in environment variables. The dashboard is intentionally not public so queue operations are not exposed without authorization.

## 16. Development Workflow
Git is the source of truth for code.

PROJECT_STATE.md and TASKS.md track progress between Antigravity and Codex sessions.

## 17. Authentication Design
Google OAuth is used for sign-in and the backend creates or updates a user record from the authenticated Google profile.

The app stores a signed JWT in an HTTP-only cookie named reachinbox_session. This keeps the session token out of frontend JavaScript while still allowing the browser to send it automatically on later requests. The API uses the token to populate req.user and protect routes with a requireAuth middleware.

If Google OAuth credentials are missing or invalid, the app returns a clear configuration error instead of silently failing. The frontend is designed to redirect the user to the backend login endpoint and then read the protected /api/auth/me route after the cookie is set.

## 18. Environment Loading
The backend now loads the repository-root .env file explicitly by path instead of relying on the current working directory. This prevents missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and JWT_SECRET values when the app is started from the backend folder or from another working directory. The configuration is still validated through Zod at startup so the app fails clearly when a required value is absent.

## 19. Verified Google OAuth Flow
Phase 8 verification confirms the browser can start OAuth, the backend exchanges the authorization code for Google tokens, the Google user profile is retrieved, the ReachInbox JWT/session is created and stored in an HTTP-only cookie, and the frontend reads /api/auth/me successfully with cookies included. The backend also enforces the state check and redirects the browser back to the frontend with a clear error message when OAuth or auth state is invalid. This keeps the login flow secure without exposing secrets, tokens, or cookies to frontend JavaScript.

## 20. Dashboard Design
The dashboard is intentionally protected by the same authenticated cookie/JWT session used for Google sign-in. After login, the frontend calls /api/auth/me to load the signed-in user and then requests /api/emails with a status filter and optional search query. The backend enforces `requireAuth`, restricts the result set to the current user, and returns email records in a compact shape appropriate for the table UI. This keeps the dashboard user-scoped, easier to test, and consistent with the project’s security model.

## 21. Compose and CSV Validation
Phase 10 keeps the same authenticated ownership system for email creation. Users select from their own senders, provide recipient emails as a list or CSV file, and the frontend normalizes duplicates before submitting a request. The backend validation layer keeps the payload strict by requiring a valid sender ID, at least one valid recipient, a non-empty subject, a non-empty body, and a numeric schedule configuration for the delay and hourly cap. This makes the compose flow robust without exposing secrets or allowing cross-user scheduling.

## 22. Verification Gate
Phase 11 is treated as a verification gate rather than a new feature phase. The repository is only considered ready to advance when the backend regression suite passes, the production builds succeed, the live backend health checks respond correctly, and the protected auth endpoints continue to reject unauthenticated requests. This keeps the project honest, prevents scope creep into later phases, and provides evidence before any final submission work is attempted.

## 23. Slack Dashboard and Delivery History
Slack connect, status, and disconnect actions require the existing authenticated session and always use that session's user ID. Slack OAuth state is a signed, short-lived token so the callback cannot select another account by changing a raw user ID. The callback returns the user to the frontend with a result message. The Sent delivery-history view queries both SENT and FAILED records so users can distinguish completed deliveries from failures.
