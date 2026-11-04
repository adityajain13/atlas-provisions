import { describe, expect, it, vi } from 'vitest';
import { parseReceiptImage } from './receipts';

const RECEIPT = { readable: true, merchant: 'No Frills', items: [{ name: 'Broccoli crowns', price: 3 }], total: 3 };

function toolReply(input: unknown) {
  return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_receipt', input }] }), { status: 200 });
}

/** Fake fetch that answers each call from a script, in order. */
function scripted(replies: (() => Response | Promise<Response>)[]) {
  const fetchImpl = vi.fn(async (..._args: unknown[]) => {
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply left');
    return next();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl };
}

const modelOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string).model as string;

describe('parseReceiptImage', () => {
  it('returns the receipt from the first model when it answers', async () => {
    const { fetchImpl, calls } = scripted([() => toolReply(RECEIPT)]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);

    expect(out).toEqual({ ok: true, receipt: RECEIPT });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(modelOf(calls.mock.calls[0]!)).toBe('claude-sonnet-5-5');
    const body = JSON.parse((calls.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.messages[0].content[1].text).toContain('Answer only by calling the record_receipt tool, exactly once.');
    expect(body.messages[0].content[0].source.media_type).toBe('image/jpeg');
    expect(body.tools[0].input_schema.properties.category).toBeUndefined();
    expect(body.tools[0].input_schema.properties.items.items.properties).toHaveProperty('size');
    expect(body.tools[0].input_schema.properties.items.items.properties).toHaveProperty('code');
  });

  it('falls back to the second model when the first fails', async () => {
    const { fetchImpl, calls } = scripted([
      () => new Response('{"error":{"message":"overloaded"}}', { status: 500 }),
      () => toolReply(RECEIPT),
    ]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);

    expect(out).toEqual({ ok: true, receipt: RECEIPT });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(modelOf(calls.mock.calls[0]!)).toBe('claude-sonnet-5-5');
    expect(modelOf(calls.mock.calls[1]!)).toBe('claude-haiku-5-5');
  });

  it('honours RECEIPT_MODEL and EXTRACT_MODEL', async () => {
    const { fetchImpl, calls } = scripted([() => toolReply(RECEIPT)]);
    await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k', RECEIPT_MODEL: 'm-one', EXTRACT_MODEL: 'm-two' }, fetchImpl);
    expect(modelOf(calls.mock.calls[0]!)).toBe('m-one');
  });

  it('returns 422 when both models say the photo is not a readable receipt', async () => {
    const unreadable = { readable: false, items: [] };
    const { fetchImpl } = scripted([() => toolReply(unreadable), () => toolReply(unreadable)]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);
    expect(out).toMatchObject({ ok: false, status: 422 });
  });

  it('returns 502 with the status when no model answers', async () => {
    const { fetchImpl } = scripted([
      () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }),
      () => new Response('nope', { status: 500 }),
    ]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(502);
      expect(out.message).toContain('500');
    }
  });

  it('returns 502 when the request itself fails, without throwing', async () => {
    const { fetchImpl } = scripted([
      () => {
        throw new Error('socket hang up');
      },
      () => {
        throw new Error('socket hang up');
      },
    ]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);
    expect(out).toMatchObject({ ok: false, status: 502 });
  });

  it('treats a reply with no tool call as no answer, after one retry per model', async () => {
    const empty = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }), { status: 200 });
    const { fetchImpl, calls } = scripted([empty, empty, empty, empty]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);
    expect(out).toMatchObject({ ok: false, status: 502 });
    expect(calls).toHaveBeenCalledTimes(4);
  });

  it('uses a JSON object in the text reply', async () => {
    const text = () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(RECEIPT) }] }), { status: 200 });
    const { fetchImpl, calls } = scripted([text]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);
    expect(out).toEqual({ ok: true, receipt: RECEIPT });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('asks the same model again with the image and an extra user turn when the first reply has no answer', async () => {
    const text = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Reading it now.' }] }), { status: 200 });
    const { fetchImpl, calls } = scripted([text, () => toolReply(RECEIPT)]);
    const out = await parseReceiptImage('BASE64', { ANTHROPIC_API_KEY: 'k' }, fetchImpl);

    expect(out).toEqual({ ok: true, receipt: RECEIPT });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(modelOf(calls.mock.calls[1]!)).toBe('claude-sonnet-5-5');
    const retry = JSON.parse((calls.mock.calls[1]![1] as RequestInit).body as string);
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[0].content[0].type).toBe('image');
    expect(retry.messages[1]).toEqual({ role: 'assistant', content: 'Reading it now.' });
    expect(retry.messages[2]).toEqual({ role: 'user', content: 'Call record_receipt now with your answer.' });
    expect(retry.tool_choice).toEqual({ type: 'auto' });
  });
});
