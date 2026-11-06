import type { RawPlan } from '@provisions/shared';
import { SUBMIT_PLAN_TOOL } from './prompt';
import { PREP_TOOL, type PrepClient } from './prep';
import { answerFrom, answerOnlyInstruction, retryMessages, textOf, type ContentBlock } from '../toolAnswer';

export interface PlannerClient {
  submitPlan(system: string, payload: unknown): Promise<RawPlan>;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ERROR_CHARS = 500;

interface MessageResponse {
  stop_reason?: string;
  content?: ContentBlock[];
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

  const send = async (messages: unknown[]): Promise<MessageResponse> => {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        tools: [tool],
        tool_choice: { type: 'auto' },
        messages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Claude API returned ${res.status}: ${text.slice(0, MAX_ERROR_CHARS)}`);
    }
    try {
      return JSON.parse(text) as MessageResponse;
    } catch {
      throw new Error(`Claude API returned invalid JSON: ${text.slice(0, MAX_ERROR_CHARS)}`);
    }
  };

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
