/**
 * The planner payload from one Messages API request body. The payload is sent as two text blocks (the shared part, then
 * the part that varies), so the blocks are read back and merged. A plain string body is read as it is.
 */
export function sentPlannerPayload(body: { messages: { content: unknown }[] }): Record<string, unknown> {
  const content = body.messages[0]!.content;
  if (typeof content === 'string') return JSON.parse(content) as Record<string, unknown>;
  return (content as { text: string }[]).reduce<Record<string, unknown>>((merged, block) => ({ ...merged, ...(JSON.parse(block.text) as object) }), {});
}
