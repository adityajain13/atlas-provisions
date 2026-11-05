// Outgoing sign-in mail. Two paths:
//   - RESEND_API_KEY set: Resend's HTTP API (domain adityajain.ca verified in Resend). Any address can receive.
//   - otherwise: Email Routing's send_email binding (free plan): raw MIME in an EmailMessage.
//     It only delivers to verified destination addresses, so mail goes to the allow-listed owner.
import { EmailMessage } from 'cloudflare:email';
import { randomToken } from './authCore';

export interface MailEnv {
  EMAIL: SendEmail;
  MAIL_FROM: string;
  /** Worker secret. When set, mail is sent through Resend instead of send_email. */
  RESEND_API_KEY?: string;
}

export interface MailMessage {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const ERROR_BODY_CHARS = 300;

const enc = new TextEncoder();

const b64 = (s: string) => {
  const bytes = enc.encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/.{76}/g, '$&\r\n');
};

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s).replace(/\r\n/g, '')}?=`);

export async function sendMail(
  env: MailEnv,
  m: MailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (env.RESEND_API_KEY) {
    await sendViaResend(env.RESEND_API_KEY, env.MAIL_FROM, m, fetchImpl);
    return;
  }
  await sendViaEmailRouting(env, m);
}

async function sendViaResend(apiKey: string, mailFrom: string, m: MailMessage, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${m.fromName} <${mailFrom}>`,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      html: m.html,
    }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CHARS);
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

async function sendViaEmailRouting(env: MailEnv, m: MailMessage): Promise<void> {
  const domain = env.MAIL_FROM.split('@')[1];
  const boundary = `ap-${randomToken(12)}`;
  const head = [
    `From: ${encodeHeader(m.fromName)} <${env.MAIL_FROM}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Message-ID: <${randomToken(16)}@${domain}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  const part = (type: string, body: string) =>
    [`Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', b64(body)].join('\r\n');
  const raw = m.html
    ? [
        ...head,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        part('text/plain', m.text),
        `--${boundary}`,
        part('text/html', m.html),
        `--${boundary}--`,
        '',
      ].join('\r\n')
    : [...head, part('text/plain', m.text), ''].join('\r\n');
  await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, m.to, raw));
}
