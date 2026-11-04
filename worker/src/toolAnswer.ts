// Getting a structured answer from a Messages API reply when tool_choice cannot force the tool.
// The model is asked to answer by calling the tool. If it answers in text instead, a JSON object in
// that text is used, and otherwise the caller asks once more.

export interface ContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

/** The instruction for the system prompt (or the user text): answer only through the tool. */
export function answerOnlyInstruction(toolName: string): string {
  return `Answer only by calling the ${toolName} tool, exactly once. Do not reply with text.`;
}

/** The extra user turn sent when the first reply had no tool call. */
export function retryInstruction(toolName: string): string {
  return `Call ${toolName} now with your answer.`;
}

/** All text blocks of a reply, joined. */
export function textOf(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** A plain JSON object inside free text (bare or in a code fence), or undefined. */
export function jsonObjectIn(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The answer from a reply: the named tool's input when it is an object, else a JSON object in the text. */
export function answerFrom(content: ContentBlock[] | undefined, toolName: string): Record<string, unknown> | undefined {
  const call = content?.find((b) => b.type === 'tool_use' && b.name === toolName);
  if (call) {
    const input = call.input;
    return typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
  }
  return jsonObjectIn(textOf(content));
}

/**
 * The messages for the one retry: the original user turn, the model's text reply if it gave one (so the
 * turns alternate), and the instruction to call the tool now.
 */
export function retryMessages(userContent: unknown, replyText: string, toolName: string): unknown[] {
  return [
    { role: 'user', content: userContent },
    ...(replyText ? [{ role: 'assistant', content: replyText }] : []),
    { role: 'user', content: retryInstruction(toolName) },
  ];
}
