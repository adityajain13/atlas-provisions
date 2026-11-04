import { describe, expect, it, vi } from 'vitest';
import { anthropicClient } from './claude';
import { SUBMIT_PLAN_TOOL } from './prompt';

const PLAN_INPUT = { meals: [{ id: 'thu-dinner', slotId: 'thu-dinner', name: 'Chili', ingredients: [], activeMinutes: 30, steps: [], tags: [] }], notes: 'ok' };

function fetchReturning(status: number, body: string) {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function toolUse(input: unknown) {
  return JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_plan', input }] });
}

describe('anthropicClient', () => {
  it('posts the payload with the submit_plan tool and returns its input', async () => {
    const fetchImpl = fetchReturning(200, toolUse(PLAN_INPUT));
    const client = anthropicClient('test-key', 'test-model', fetchImpl);

    const out = await client.submitPlan('SYSTEM', { weekOf: '2026-11-15' });

    expect(out).toEqual(PLAN_INPUT);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
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
    expect(JSON.parse(body.messages[0].content)).toEqual({ weekOf: '2026-11-15' });
  });

  it('throws with the status and the body, truncated to 500 characters, on a non-2xx response', async () => {
    const client = anthropicClient('k', 'm', fetchReturning(429, 'x'.repeat(1000)));
    let message = '';
    try {
      await client.submitPlan('s', {});
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message.startsWith('Claude API returned 429: ')).toBe(true);
    expect(message.length).toBe('Claude API returned 429: '.length + 500);
  });

  it('throws when the response has no submit_plan tool call', async () => {
    const body = JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'hmm' }] });
    const client = anthropicClient('k', 'm', fetchReturning(200, body));
    await expect(client.submitPlan('s', {})).rejects.toThrow('did not call submit_plan (stop reason: max_tokens)');
  });

  it('throws when the tool input has no meals array', async () => {
    const client = anthropicClient('k', 'm', fetchReturning(200, toolUse({ notes: 'no meals' })));
    await expect(client.submitPlan('s', {})).rejects.toThrow('no meals array');
  });

  it('passes the prep list from the same call through, unchecked', async () => {
    const prep = { day: 'sun', steps: [{ id: 'a', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'] }] };
    const client = anthropicClient('k', 'm', fetchReturning(200, toolUse({ ...PLAN_INPUT, prep })));
    expect(await client.submitPlan('s', {})).toEqual({ ...PLAN_INPUT, prep });
  });

  it('leaves prep out when the call did not return it', async () => {
    const client = anthropicClient('k', 'm', fetchReturning(200, toolUse(PLAN_INPUT)));
    expect(await client.submitPlan('s', {})).not.toHaveProperty('prep');
  });
});

function textReply(text: string, stop = 'end_turn') {
  return JSON.stringify({ stop_reason: stop, content: [{ type: 'text', text }] });
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('anthropicClient without a forced tool call', () => {
  it('uses a JSON object in the text reply when there is no tool call', async () => {
    const fetchImpl = vi.fn(async () => new Response(textReply(`Here you go:\n\`\`\`json\n${JSON.stringify(PLAN_INPUT)}\n\`\`\``), { status: 200 }));
    const client = anthropicClient('k', 'm', fetchImpl as unknown as typeof fetch);
    expect(await client.submitPlan('s', {})).toEqual(PLAN_INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks once more with an extra user turn when the text has no JSON, then uses the tool call', async () => {
    const replies = [
      new Response(textReply('I will plan the week now.'), { status: 200 }),
      new Response(toolUse(PLAN_INPUT), { status: 200 }),
    ];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const client = anthropicClient('k', 'm', fetchImpl as unknown as typeof fetch);

    expect(await client.submitPlan('s', { weekOf: '2026-11-15' })).toEqual(PLAN_INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const retry = bodyOf(fetchImpl.mock.calls[1] as unknown[]);
    expect(retry.messages).toEqual([
      { role: 'user', content: JSON.stringify({ weekOf: '2026-11-15' }) },
      { role: 'assistant', content: 'I will plan the week now.' },
      { role: 'user', content: 'Call submit_plan now with your answer.' },
    ]);
    expect(retry.tool_choice).toEqual({ type: 'auto' });
  });

  it('throws the descriptive error when the retry also has no tool call', async () => {
    const fetchImpl = vi.fn(async () => new Response(textReply('no', 'max_tokens'), { status: 200 }));
    const client = anthropicClient('k', 'm', fetchImpl as unknown as typeof fetch);
    await expect(client.submitPlan('s', {})).rejects.toThrow('did not call submit_plan (stop reason: max_tokens)');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the API itself fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 529 }));
    const client = anthropicClient('k', 'm', fetchImpl as unknown as typeof fetch);
    await expect(client.submitPlan('s', {})).rejects.toThrow('Claude API returned 529: busy');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

