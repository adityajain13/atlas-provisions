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

    const out = await client.submitPlan('SYSTEM', { weekOf: '2026-11-12' });

    expect(out).toEqual(PLAN_INPUT);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(8000);
    expect(body.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools).toEqual([SUBMIT_PLAN_TOOL]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_plan' });
    expect(JSON.parse(body.messages[0].content)).toEqual({ weekOf: '2026-11-12' });
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
});
