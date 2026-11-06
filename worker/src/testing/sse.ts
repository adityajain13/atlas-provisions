// Builds Messages API streaming replies for tests. A reply is the SSE events the API sends for one message, cut into
// chunks, so a test sees lines and events split across reads the way a network would deliver them.

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

const MESSAGE_START: SseEvent = {
  event: 'message_start',
  data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], stop_reason: null } },
};

const MESSAGE_STOP: SseEvent = { event: 'message_stop', data: { type: 'message_stop' } };

function messageDelta(stopReason: string): SseEvent {
  return {
    event: 'message_delta',
    data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } },
  };
}

/** A reply that calls `name` with `input`. The input JSON is split into pieces of `pieceChars` characters. */
export function toolUseEvents(input: unknown, opts: { name?: string; pieceChars?: number; stopReason?: string } = {}): SseEvent[] {
  const { name = 'submit_plan', pieceChars = 17, stopReason = 'tool_use' } = opts;
  const json = JSON.stringify(input);
  const pieces: string[] = [];
  for (let i = 0; i < json.length; i += pieceChars) pieces.push(json.slice(i, i + pieceChars));
  return [
    MESSAGE_START,
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_test', name, input: {} } },
    },
    ...pieces.map((partial_json) => ({
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } },
    })),
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    messageDelta(stopReason),
    MESSAGE_STOP,
  ];
}

/** A reply that is text only. */
export function textEvents(text: string, stopReason = 'end_turn', pieceChars = 40): SseEvent[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += pieceChars) pieces.push(text.slice(i, i + pieceChars));
  return [
    MESSAGE_START,
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    ...pieces.map((t) => ({
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
    })),
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    messageDelta(stopReason),
    MESSAGE_STOP,
  ];
}

/** The SSE text for the events, as the API writes it: `event:` and `data:` lines, then a blank line. */
export function sseText(events: SseEvent[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

/** A 200 response streaming `events`, delivered in chunks of `chunkChars` characters. */
export function sseResponse(events: SseEvent[], chunkChars = 64): Response {
  const text = sseText(events);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkChars) chunks.push(text.slice(i, i + chunkChars));
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A 200 streamed reply whose only content is a call to `name` with `input`. */
export function toolReply(input: unknown, name = 'submit_plan'): Response {
  return sseResponse(toolUseEvents(input, { name }));
}
