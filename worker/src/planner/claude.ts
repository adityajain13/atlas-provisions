import type { RawPlan } from '@provisions/shared';
import { SUBMIT_PLAN_TOOL } from './prompt';
import { PREP_TOOL, type PrepClient } from './prep';
import { answerFrom, answerOnlyInstruction, retryMessages, textOf, type ContentBlock } from '../toolAnswer';

export interface PlannerClient {
  submitPlan(system: string, payload: unknown): Promise<RawPlan>;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ERROR_CHARS = 500;
/** No bytes from the API for this long: the request is given up. */
export const IDLE_TIMEOUT_MS = 60_000;
/** The whole request, however much it streams, is given up after this long. */
export const TOTAL_TIMEOUT_MS = 300_000;

interface MessageResponse {
  stop_reason?: string;
  content?: ContentBlock[];
}

/** What the user sees when a request is given up. `seconds` is the limit that ran out. */
export function planningTimedOut(seconds: number): string {
  return `Planning took too long (over ${seconds} s). Try again — if it keeps happening, reduce the number of meals or cravings.`;
}

interface StreamBlock {
  type: string;
  name?: string;
  id?: string;
  text: string;
  json: string;
  input?: unknown;
}

/** Rebuilds a complete Messages API reply from its stream events. */
class StreamAssembler {
  private readonly blocks = new Map<number, StreamBlock>();
  private stopReason: string | undefined;
  private finished = false;

  /** One SSE event. An `error` event throws; so does a data line that is not JSON. */
  handle(event: string, raw: string): void {
    let data: { type?: string; index?: number; content_block?: Partial<StreamBlock>; delta?: Record<string, unknown>; error?: { type?: string; message?: string } };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new Error(`Claude API stream sent invalid data: ${raw.slice(0, MAX_ERROR_CHARS)}`);
    }
    const type = event || data.type;
    if (type === 'error') {
      throw new Error(`Claude API stream failed: ${data.error?.type ?? 'error'}: ${String(data.error?.message ?? '').slice(0, MAX_ERROR_CHARS)}`);
    }
    if (type === 'content_block_start' && data.content_block && typeof data.index === 'number') {
      const cb = data.content_block;
      this.blocks.set(data.index, { type: cb.type ?? '', name: cb.name, id: cb.id, text: cb.text ?? '', json: '', input: cb.input });
    } else if (type === 'content_block_delta' && typeof data.index === 'number') {
      const block = this.blocks.get(data.index);
      if (!block || !data.delta) return;
      if (data.delta.type === 'text_delta' && typeof data.delta.text === 'string') block.text += data.delta.text;
      if (data.delta.type === 'input_json_delta' && typeof data.delta.partial_json === 'string') block.json += data.delta.partial_json;
    } else if (type === 'message_delta') {
      const reason = data.delta?.stop_reason;
      if (typeof reason === 'string') this.stopReason = reason;
    } else if (type === 'message_stop') {
      this.finished = true;
    }
  }

  result(): MessageResponse {
    if (!this.finished) throw new Error('Claude API stream ended before the reply was complete');
    const content: ContentBlock[] = [...this.blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, b]) => {
        if (b.type === 'tool_use') return { type: 'tool_use', name: b.name, input: parseToolInput(b) };
        if (b.type === 'text') return { type: 'text', text: b.text };
        return { type: b.type };
      });
    return { stop_reason: this.stopReason, content };
  }
}

/** The tool input from its streamed JSON pieces. No pieces means an empty object. */
function parseToolInput(block: StreamBlock): unknown {
  try {
    return JSON.parse(block.json || '{}') as unknown;
  } catch {
    throw new Error(`Claude API returned invalid tool input: ${block.json.slice(0, MAX_ERROR_CHARS)}`);
  }
}

/**
 * Reads the SSE body. Lines may split across chunks, so text is buffered until a newline. Each chunk resets the idle
 * timer through `onChunk`. `guard` races a read against the abort, so a body that ignores the signal still stops.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
  guard: <T>(p: Promise<T>) => Promise<T>,
): Promise<MessageResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const assembler = new StreamAssembler();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) assembler.handle(eventName, dataLines.join('\n'));
    eventName = '';
    dataLines = [];
  };
  const line = (text: string) => {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  };

  try {
    for (;;) {
      const { done, value } = await guard(reader.read());
      if (done) break;
      onChunk();
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer !== '') line(buffer.replace(/\r$/, ''));
    dispatch();
    return assembler.result();
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/**
 * POSTs one streaming Messages request and returns the reassembled reply. Two timers stop it: IDLE_TIMEOUT_MS with
 * no bytes from the API, and TOTAL_TIMEOUT_MS overall. Either one aborts the request and throws planningTimedOut.
 * Both timers are cleared when the reply is read, or fails.
 */
async function postStreaming(fetchImpl: typeof fetch, headers: Record<string, string>, body: string): Promise<MessageResponse> {
  const controller = new AbortController();
  let limitSeconds = 0;
  const trip = (ms: number) => {
    if (limitSeconds === 0) limitSeconds = ms / 1000;
    controller.abort();
  };
  let idle: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => trip(IDLE_TIMEOUT_MS), IDLE_TIMEOUT_MS);
  };
  const total = setTimeout(() => trip(TOTAL_TIMEOUT_MS), TOTAL_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  aborted.catch(() => {});
  const guard = <T>(p: Promise<T>) => Promise.race([p, aborted]);

  try {
    armIdle();
    const res = await guard(
      fetchImpl(API_URL, { method: 'POST', signal: controller.signal, headers, body }),
    );
    if (!res.ok) {
      const text = await guard(res.text());
      throw new Error(`Claude API returned ${res.status}: ${text.slice(0, MAX_ERROR_CHARS)}`);
    }
    if (!res.body) throw new Error('Claude API returned no body');
    return await readStream(res.body, armIdle, guard);
  } catch (e) {
    if (limitSeconds > 0) throw new Error(planningTimedOut(limitSeconds));
    throw e;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

/**
 * One Messages API call whose answer is the input of `tool`. The model is asked to answer only by
 * calling the tool; tool_choice stays auto, because forced tool use is rejected by claude-sonnet-5-5.
 * When the reply has no tool call, a JSON object in its text is used, and otherwise the model is asked
 * once more. Returns the tool's input as sent, not yet validated. `fetchImpl` is injectable so tests
 * never reach the network.
 */
export async function callTool(
  apiKey: string,
  model: string,
  system: string,
  payload: unknown,
  tool: ToolDef,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  maxTokens = 8000,
): Promise<unknown> {
  const systemText = `${system}\n\n${answerOnlyInstruction(tool.name)}`;
  const userText = JSON.stringify(payload);

  // Streamed: a long plan takes minutes to write, and a single JSON reply would have to wait for all of it.
  const send = (messages: unknown[]): Promise<MessageResponse> =>
    postStreaming(
      fetchImpl,
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        tools: [tool],
        tool_choice: { type: 'auto' },
        messages,
      }),
    );

  const first = await send([{ role: 'user', content: userText }]);
  const answer = answerFrom(first.content, tool.name);
  if (answer !== undefined) return answer;

  const second = await send(retryMessages(userText, textOf(first.content), tool.name));
  const retried = answerFrom(second.content, tool.name);
  if (retried !== undefined) return retried;
  throw new Error(`Claude did not call ${tool.name} (stop reason: ${second.stop_reason ?? 'unknown'})`);
}

/**
 * Anthropic Messages API client for the weekly plan. The plan comes back through the submit_plan
 * tool, so the tool input is the plan.
 */
export function anthropicClient(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): PlannerClient {
  return {
    async submitPlan(system, payload) {
      const input = (await callTool(apiKey, model, system, payload, SUBMIT_PLAN_TOOL, fetchImpl, 16000)) as
        | Partial<RawPlan>
        | undefined;
      if (!input || !Array.isArray(input.meals)) {
        throw new Error('submit_plan input has no meals array');
      }
      return {
        meals: input.meals,
        notes: typeof input.notes === 'string' ? input.notes.slice(0, 200) : '',
        // Checked by runPlanner against the kept attempt's meals. Missing or invalid prep is not an error.
        ...(input.prep !== undefined ? { prep: input.prep } : {}),
      };
    },
  };
}

/** Anthropic client for the batch prep list. The tool input is returned as-is for validation. */
export function anthropicPrepClient(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): PrepClient {
  return {
    submitPrep: (system, payload) => callTool(apiKey, model, system, payload, PREP_TOOL, fetchImpl, 4000),
  };
}
