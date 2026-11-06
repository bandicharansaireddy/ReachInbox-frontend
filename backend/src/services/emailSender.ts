import nodemailer from 'nodemailer';

import { env } from '../config/env.ts';

const transporterCache: {
  transport?: ReturnType<typeof nodemailer.createTransport>;
  createdAt?: number;
} = {};

export async function getEmailTransport() {
  if (transporterCache.transport && transporterCache.createdAt && Date.now() - transporterCache.createdAt < 60 * 60 * 1000) {
    return transporterCache.transport;
  }

  const auth = env.SMTP_USER && env.SMTP_PASSWORD
    ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    : await (async () => {
        const account = await nodemailer.createTestAccount();
        return { user: account.user, pass: account.pass };
      })();

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth,
  });

  await transport.verify();

  transporterCache.transport = transport;
  transporterCache.createdAt = Date.now();

  return transport;
}

export async function sendEmailMessage({
  to,
  subject,
  body,
  from = env.EMAIL_FROM,
}: {
  to: string;
  subject: string;
  body: string;
  from?: string;
}) {
  const transport = await getEmailTransport();
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text: body,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info) ?? null,
  };
}
