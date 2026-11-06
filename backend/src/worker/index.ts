import { env } from '../config/env.ts';
import { createEmailQueue, createEmailWorker, gracefulShutdown, reconcileMissingJobs } from '../queue/emailQueue.ts';
import { retryQueuedEmailIndexEntries } from '../services/emailSearchService.ts';

const recoveryQueue = createEmailQueue();
const worker = createEmailWorker({ concurrency: env.WORKER_CONCURRENCY });

void retryQueuedEmailIndexEntries().catch(() => undefined);

void reconcileMissingJobs({ queue: recoveryQueue, scheduleJob: async (email, queue) => {
  const result = await import('../queue/emailQueue.ts').then(({ scheduleEmailJob }) => scheduleEmailJob(email, queue));
  return result;
} }).then((missingJobs) => {
  if (missingJobs.length > 0) {
    console.log(`Re-enqueued ${missingJobs.length} missing email jobs after worker restart.`);
  }
}).catch((error) => {
  console.error('Failed to reconcile queued emails after startup:', error);
});

const shutdown = async () => {
  await gracefulShutdown(worker, [recoveryQueue]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Email worker started for queue ${env.REDIS_URL}`);
