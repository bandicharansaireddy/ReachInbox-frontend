
# ReachInbox Project Instructions

## Project Overview
Build a full-stack email scheduler for the ReachInbox hiring assignment.

This project must be reliable, maintainable, and demonstrable. The assignment deadline is 48 hours.

## Required Technology Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- React Router

### Backend
- Node.js
- Express
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Nodemailer
- Ethereal Email
- Elasticsearch
- Google OAuth
- Slack OAuth
- Bull Board

## Mandatory Assignment Requirements

- Schedule emails for future delivery.
- Use BullMQ delayed jobs. Do NOT use cron.
- Emails must survive backend and worker restarts.
- Support multiple email senders.
- Support configurable worker concurrency.
- Support minimum delay between emails.
- Support configurable hourly sending limits.
- Rate limits must work across multiple workers.
- Jobs must be rescheduled when rate limits are reached, not discarded.
- Prevent duplicate email processing as far as technically possible.
- Send emails through Ethereal SMTP.
- Implement real Google OAuth authentication.
- Implement real Slack OAuth connection.
- Send actual Slack notifications when rate limits are reached.
- Slack integration must not crash the worker when disconnected or unavailable.
- Index email data in Elasticsearch and support searching.
- Provide Bull Board to monitor queue jobs.
- Build a React dashboard with Scheduled and Sent email tabs.
- Support composing emails and importing recipients from CSV.
- Include proper loading, empty, and error states.

## Architecture Rules

- PostgreSQL is the primary source of truth.
- Redis is used for BullMQ and shared rate-limit coordination.
- API server and email worker must run separately.
- Use one database record per recipient email.
- Use deterministic BullMQ job IDs to prevent duplicate jobs.
- Use database migrations.
- Validate API inputs using Zod.
- Use environment variables for credentials and configuration.
- Never expose secrets in frontend code.
- Never commit .env files or credentials.
- Document any limitations honestly, especially SMTP delivery guarantees.

## Development Rules

1. Inspect existing files before making changes.
2. Do not overwrite working code unnecessarily.
3. Do not change the required technology stack without approval.
4. Work on one milestone at a time.
5. Implement actual functionality, not fake buttons or mock integrations.
6. Write tests for critical functionality.
7. Run relevant tests and builds before claiming success.
8. Explain important changes in beginner-friendly language.
9. Do not claim that a feature works unless it has been verified.
10. Do not delete project files or reset Git history without approval.

## Antigravity and Codex Handoff Rules

The Git repository is the source of truth, not the AI conversation.

Before starting work:
- Read this file.
- Read PROJECT_STATE.md.
- Read TASKS.md.
- Read DECISIONS.md.
- Inspect the existing code and Git status.
- Continue from the recorded next task.

After completing a milestone:
- Update PROJECT_STATE.md.
- Update TASKS.md.
- Update README.md when relevant.
- Record important architectural decisions in DECISIONS.md.
- Report changed files, tests, problems, and next steps.

When switching between Antigravity and Codex:
- Preserve all existing work.
- Do not recreate the project from scratch.
- Inspect uncommitted changes before editing.
- Continue from the existing implementation.

## Git Rules

- Commit after meaningful milestones.
- Use descriptive commit messages.
- Never commit secrets.
- Never force-push without explicit approval.
- Never use destructive Git commands without approval.
- Preserve unfinished work.

## Final Deliverables

- Working full-stack application.
- Private GitHub repository.
- README with setup and usage instructions.
- .env.example without actual secrets.
- Demo video of maximum 5 minutes.
- Assignment submission.

## Current Priority

Complete the project in small, verified milestones.

Start with project foundation, environment setup, database, Redis, and health checks.

Do not implement all features in one giant change.