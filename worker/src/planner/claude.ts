import type { RawPlan } from '@provisions/shared';
import { SUBMIT_PLAN_TOOL } from './prompt';

export interface PlannerClient {
  submitPlan(system: string, payload: unknown): Promise<RawPlan>;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ERROR_CHARS = 500;

interface MessageResponse {
  stop_reason?: string;
  content?: { type: string; name?: string; input?: unknown }[];
}

/**
 * Anthropic Messages API client. The plan comes back through the submit_plan tool, so the
 * tool input is the plan. `fetchImpl` is injectable so tests never reach the network.
 */
export function anthropicClient(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): PlannerClient {
  return {
    async submitPlan(system, payload) {
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
          max_tokens: 8000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools: [SUBMIT_PLAN_TOOL],
          tool_choice: { type: 'tool', name: 'submit_plan' },
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Claude API returned ${res.status}: ${text.slice(0, MAX_ERROR_CHARS)}`);
      }

      let body: MessageResponse;
      try {
        body = JSON.parse(text) as MessageResponse;
      } catch {
        throw new Error(`Claude API returned invalid JSON: ${text.slice(0, MAX_ERROR_CHARS)}`);
      }
      const block = body.content?.find((b) => b.type === 'tool_use' && b.name === 'submit_plan');
      if (!block) {
        throw new Error(`Claude did not call submit_plan (stop reason: ${body.stop_reason ?? 'unknown'})`);
      }
      const input = block.input as Partial<RawPlan> | undefined;
      if (!input || !Array.isArray(input.meals)) {
        throw new Error('submit_plan input has no meals array');
      }
      return { meals: input.meals, notes: typeof input.notes === 'string' ? input.notes : '' };
    },
  };
}
