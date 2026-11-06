import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicClient, IDLE_TIMEOUT_MS, planningTimedOut, TOTAL_TIMEOUT_MS } from './claude';
import { SUBMIT_PLAN_TOOL } from './prompt';
import { sseResponse, sseText, textEvents, toolReply, toolUseEvents, type SseEvent } from '../testing/sse';

const PLAN_INPUT = { meals: [{ id: 'thu-dinner', slotId: 'thu-dinner', name: 'Chili', ingredients: [], activeMinutes: 30, steps: [], tags: [] }], notes: 'ok' };

type Fetch = typeof fetch & ReturnType<typeof vi.fn>;

/** A fetch that answers each call with the next reply maker. Calls past the end are a test bug. */
function fetchOf(...replies: (() => Response)[]): Fetch {
  const queue = [...replies];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch called more times than the test expected');
    return next();
  }) as unknown as Fetch;
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('anthropicClient', () => {
  it('posts a streaming request with the submit_plan tool and returns its input', async () => {
    const fetchImpl = fetchOf(() => toolReply(PLAN_INPUT));
    const client = anthropicClient('test-key', 'test-model', fetchImpl);

    const out = await client.submitPlan('SYSTEM', { weekOf: '2026-11-15', prepDay: 'sun' });

    expect(out).toEqual(PLAN_INPUT);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(16000);
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'SYSTEM\n\nAnswer only by calling the submit_plan tool, exactly once. Do not reply with text.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(body.tools).toEqual([SUBMIT_PLAN_TOOL]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    // The payload is sent in two parts: the shared part (cached) first, then the part that varies.
    const [shared, varying] = body.messages[0].content;
    expect(shared).toEqual({ type: 'text', text: JSON.stringify({ prepDay: 'sun' }), cache_control: { type: 'ephemeral' } });
    expect(varying).toEqual({ type: 'text', text: JSON.stringify({ weekOf: '2026-11-15' }) });
  });

  it('sends the cached system part first and the swap part after it, uncached', async () => {
    const fetchImpl = fetchOf(() => toolReply(PLAN_INPUT));
    await anthropicClient('k', 'm', fetchImpl).submitPlan({ cached: 'BASE', uncached: 'SWAP' }, { weekOf: '2026-11-15' });
    const body = bodyOf(fetchImpl.mock.calls[0] as unknown[]);
    expect(body.system).toEqual([
      { type: 'text', text: 'BASE\n\nAnswer only by calling the submit_plan tool, exactly once. Do not reply with text.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SWAP' },
    ]);
  });

  it('uses the tool without a prep property when the payload has no prep day', async () => {
    const fetchImpl = fetchOf(() => toolReply(PLAN_INPUT));
    await anthropicClient('k', 'm', fetchImpl).submitPlan('s', { weekOf: '2026-11-15' });
    const tool = bodyOf(fetchImpl.mock.calls[0] as unknown[]).tools[0];
    expect(Object.keys(tool.input_schema.properties)).toEqual(['meals', 'notes']);
  });

  it('joins input_json_delta pieces that are split across chunks, mid-line and mid-character', async () => {
    // Tiny pieces and chunks: every JSON token is split between events and every event between reads.
    const events = toolUseEvents(PLAN_INPUT, { pieceChars: 3 });
    const fetchImpl = fetchOf(() => sseResponse(events, 5));
    expect(await anthropicClient('k', 'm', fetchImpl).submitPlan('s', {})).toEqual(PLAN_INPUT);
  });

  it('handles CRLF line endings', async () => {
    const text = sseText(toolUseEvents(PLAN_INPUT)).replace(/\n/g, '\r\n');
    const fetchImpl = fetchOf(() => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    expect(await anthropicClient('k', 'm', fetchImpl).submitPlan('s', {})).toEqual(PLAN_INPUT);
  });

  it('ignores ping events between the events of a reply', async () => {
    const events: SseEvent[] = [
      { event: 'ping', data: { type: 'ping' } },
      ...toolUseEvents(PLAN_INPUT).slice(0, 1),
      { event: 'ping', data: { type: 'ping' } },
      ...toolUseEvents(PLAN_INPUT).slice(1),
    ];
    expect(await anthropicClient('k', 'm', fetchOf(() => sseResponse(events))).submitPlan('s', {})).toEqual(PLAN_INPUT);
  });

  it('throws with the status and the body, truncated to 500 characters, on a non-2xx response', async () => {
    const client = anthropicClient('k', 'm', fetchOf(() => new Response('x'.repeat(1000), { status: 429 })));
    let message = '';
    try {
      await client.submitPlan('s', {});
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message.startsWith('Claude API returned 429: ')).toBe(true);
    expect(message.length).toBe('Claude API returned 429: '.length + 500);
  });

  it('throws the error event from the stream, with its type and message', async () => {
    const events: SseEvent[] = [
      { event: 'message_start', data: { type: 'message_start', message: {} } },
      { event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    ];
    const client = anthropicClient('k', 'm', fetchOf(() => sseResponse(events)));
    await expect(client.submitPlan('s', {})).rejects.toThrow('Claude API stream failed: overloaded_error: Overloaded');
  });

  it('throws when the stream ends before message_stop, rather than reading a partial reply', async () => {
    const events = toolUseEvents(PLAN_INPUT).filter((e) => e.event !== 'message_stop');
    const client = anthropicClient('k', 'm', fetchOf(() => sseResponse(events)));
    await expect(client.submitPlan('s', {})).rejects.toThrow('stream ended before the reply was complete');
  });

  it('throws when a streamed tool input is not valid JSON', async () => {
    const events = toolUseEvents(PLAN_INPUT).map((e) =>
      e.event === 'content_block_delta' ? { ...e, data: { ...e.data, delta: { type: 'input_json_delta', partial_json: '{"meals":' } } } : e,
    );
    const client = anthropicClient('k', 'm', fetchOf(() => sseResponse(events)));
    await expect(client.submitPlan('s', {})).rejects.toThrow('invalid tool input');
  });

  it('throws when the reply has no submit_plan tool call', async () => {
    const client = anthropicClient('k', 'm', fetchOf(() => sseResponse(textEvents('hmm', 'max_tokens')), () => sseResponse(textEvents('hmm', 'max_tokens'))));
    await expect(client.submitPlan('s', {})).rejects.toThrow('did not call submit_plan (stop reason: max_tokens)');
  });

  it('throws when the tool input has no meals array', async () => {
    const client = anthropicClient('k', 'm', fetchOf(() => toolReply({ notes: 'no meals' })));
    await expect(client.submitPlan('s', {})).rejects.toThrow('no meals array');
  });

  it('passes the prep list from the same call through, unchecked', async () => {
    const prep = { day: 'sun', steps: [{ id: 'a', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'] }] };
    const client = anthropicClient('k', 'm', fetchOf(() => toolReply({ ...PLAN_INPUT, prep })));
    expect(await client.submitPlan('s', {})).toEqual({ ...PLAN_INPUT, prep });
  });

  it('leaves prep out when the call did not return it', async () => {
    const client = anthropicClient('k', 'm', fetchOf(() => toolReply(PLAN_INPUT)));
    expect(await client.submitPlan('s', {})).not.toHaveProperty('prep');
  });
});

describe('anthropicClient without a forced tool call', () => {
  it('uses a JSON object in the text reply when there is no tool call', async () => {
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify(PLAN_INPUT)}\n\`\`\``;
    const fetchImpl = fetchOf(() => sseResponse(textEvents(text)));
    const client = anthropicClient('k', 'm', fetchImpl);
    expect(await client.submitPlan('s', {})).toEqual(PLAN_INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks once more with an extra user turn when the text has no JSON, then uses the tool call', async () => {
    const fetchImpl = fetchOf(() => sseResponse(textEvents('I will plan the week now.')), () => toolReply(PLAN_INPUT));
    const client = anthropicClient('k', 'm', fetchImpl);

    expect(await client.submitPlan('s', { weekOf: '2026-11-15' })).toEqual(PLAN_INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const retry = bodyOf(fetchImpl.mock.calls[1] as unknown[]);
    expect(retry.stream).toBe(true);
    expect(retry.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '{}', cache_control: { type: 'ephemeral' } }, { type: 'text', text: JSON.stringify({ weekOf: '2026-11-15' }) }] },
      { role: 'assistant', content: 'I will plan the week now.' },
      { role: 'user', content: 'Call submit_plan now with your answer.' },
    ]);
    expect(retry.tool_choice).toEqual({ type: 'auto' });
  });

  it('throws the descriptive error when the retry also has no tool call', async () => {
    const fetchImpl = fetchOf(() => sseResponse(textEvents('no', 'max_tokens')), () => sseResponse(textEvents('no', 'max_tokens')));
    const client = anthropicClient('k', 'm', fetchImpl);
    await expect(client.submitPlan('s', {})).rejects.toThrow('did not call submit_plan (stop reason: max_tokens)');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the API itself fails', async () => {
    const fetchImpl = fetchOf(() => new Response('busy', { status: 529 }));
    const client = anthropicClient('k', 'm', fetchImpl);
    await expect(client.submitPlan('s', {})).rejects.toThrow('Claude API returned 529: busy');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('streaming timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A streamed body that sends `first`, then sends nothing until the request is aborted. */
  function stalledResponse(signal: AbortSignal | null | undefined, first: SseEvent[] = toolUseEvents(PLAN_INPUT).slice(0, 1)) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseText(first)));
        signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted', 'AbortError')));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('gives up when no bytes arrive for 60 seconds, with the planning message', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => stalledResponse(init.signal)) as unknown as Fetch;
    const client = anthropicClient('k', 'm', fetchImpl);

    const attempt = client.submitPlan('s', {});
    const assertion = expect(attempt).rejects.toThrow(planningTimedOut(60));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps going while bytes arrive, then gives up at the 300 second cap', async () => {
    // A ping every 30 seconds: never idle for 60, but the whole request still runs out at 300.
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const tick = () => {
            controller.enqueue(encoder.encode(sseText([{ event: 'ping', data: { type: 'ping' } }])));
            timer = setTimeout(tick, 30_000);
          };
          tick();
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            controller.error(new DOMException('The operation was aborted', 'AbortError'));
          });
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as Fetch;
    const client = anthropicClient('k', 'm', fetchImpl);

    const attempt = client.submitPlan('s', {});
    const assertion = expect(attempt).rejects.toThrow(planningTimedOut(300));
    await vi.advanceTimersByTimeAsync(TOTAL_TIMEOUT_MS - 1000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('gives up on a request that never gets a response, even when fetch ignores the signal', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as Fetch;
    const client = anthropicClient('k', 'm', fetchImpl);

    const attempt = client.submitPlan('s', {});
    const assertion = expect(attempt).rejects.toThrow(planningTimedOut(60));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    await assertion;
  });

  it('clears both timers once a reply has been read', async () => {
    const client = anthropicClient('k', 'm', fetchOf(() => toolReply(PLAN_INPUT)));
    expect(await client.submitPlan('s', {})).toEqual(PLAN_INPUT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the planning message names the limit that ran out', () => {
    expect(planningTimedOut(60)).toBe(
      'Planning took too long (over 60 s). Try again — if it keeps happening, reduce the number of meals or cravings.',
    );
  });
});
