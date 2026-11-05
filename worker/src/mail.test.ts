// Outgoing mail: Resend path (fetch injected, no network) and the send_email fallback.
import { describe, expect, it, vi } from 'vitest';
import { sendMail, type MailEnv, type MailMessage } from './mail';

const message: MailMessage = {
  fromName: 'Atlas Provisions',
  to: 'owner@example.com',
  subject: 'Your Atlas Provisions sign-in code',
  text: 'Your login code is 482913\n\nOr sign in: https://example.com/provisions/api/auth/link?e=owner%40example.com&t=abc',
  html: '<p style="font-size:32px">482913</p><a href="https://example.com/provisions/api/auth/link?e=owner%40example.com&amp;t=abc">Sign in on this device</a>',
};

const makeEnv = (extra: Partial<MailEnv> = {}) => {
  const send = vi.fn(async (_message: unknown) => {});
  const env: MailEnv = { EMAIL: { send } as never, MAIL_FROM: 'provisions@adityajain.ca', ...extra };
  return { env, send };
};

const okFetch = () => vi.fn(async () => new Response('{"id":"abc"}', { status: 200 }));

describe('sendMail via Resend', () => {
  it('posts the message to the Resend API with the key and the expected body', async () => {
    const { env, send } = makeEnv({ RESEND_API_KEY: 're_test_123' });
    const fetchStub = okFetch();

    await sendMail(env, message, fetchStub as unknown as typeof fetch);

    expect(send).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer re_test_123', 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('Atlas Provisions <provisions@adityajain.ca>');
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.subject).toBe('Your Atlas Provisions sign-in code');
    expect(body.text).toBe(message.text);
    expect(body.html).toContain('482913');
    expect(body.html).toContain('href="https://example.com/provisions/api/auth/link?e=owner%40example.com&amp;t=abc"');
  });

  it('throws with the status and the response body, truncated to 300 characters, on a 4xx', async () => {
    const { env } = makeEnv({ RESEND_API_KEY: 're_test_123' });
    const fetchStub = vi.fn(async () => new Response('x'.repeat(500), { status: 422 }));

    await expect(sendMail(env, message, fetchStub as unknown as typeof fetch)).rejects.toThrow(
      `Resend 422: ${'x'.repeat(300)}`,
    );
  });

  it('throws on a 5xx too, even when the body cannot be read', async () => {
    const { env } = makeEnv({ RESEND_API_KEY: 're_test_123' });
    const fetchStub = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(sendMail(env, message, fetchStub as unknown as typeof fetch)).rejects.toThrow(/^Resend 503: $/);
  });
});

describe('sendMail without RESEND_API_KEY', () => {
  it('falls back to the send_email binding and never calls fetch', async () => {
    const { env, send } = makeEnv();
    const fetchStub = okFetch();

    await sendMail(env, message, fetchStub as unknown as typeof fetch);

    expect(fetchStub).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0] as unknown as { from: string; to: string; raw: string };
    expect(sent.from).toBe('provisions@adityajain.ca');
    expect(sent.to).toBe('owner@example.com');
    expect(sent.raw).toContain('From: Atlas Provisions <provisions@adityajain.ca>');
    expect(sent.raw).toContain('multipart/alternative');
  });
});
