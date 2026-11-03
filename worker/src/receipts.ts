// Grocery receipt reading. Copied from the travel planner's worker/receipts.ts and adapted:
// the category field is gone, and each line gets an optional printed size and item code.
// TODO(auth): the app has no sign-in yet. Add the session check here when it does.

export const MAX_RECEIPT_IMAGE_CHARS = 6_000_000;

export interface ReceiptEnv {
  ANTHROPIC_API_KEY?: string;
  RECEIPT_MODEL?: string;
  EXTRACT_MODEL?: string;
}

export type ParseResult =
  | { ok: true; receipt: Record<string, unknown> }
  | { ok: false; status: 422 | 502; message: string };

const API_URL = 'https://api.anthropic.com/v1/messages';

export const RECEIPT_TOOL = {
  name: 'record_receipt',
  description: "Record what's on the grocery receipt photo.",
  input_schema: {
    type: 'object',
    properties: {
      readable: { type: 'boolean', description: "False if the photo isn't a receipt or can't be read." },
      merchant: { type: 'string', description: 'Store name as printed, e.g. "No Frills", "FreshCo", "Walmart".' },
      address: { type: 'string', description: "This branch's address (or branch number if no street address is printed)." },
      date: { type: 'string', description: 'YYYY-MM-DD if printed.' },
      time: { type: 'string', description: 'HH:MM 24h if printed.' },
      currency: { type: 'string', description: 'ISO 4217 code ($ in Canada = CAD).' },
      items: {
        type: 'array',
        description:
          'Every purchased line, in order. Discounts and coupons as their own line with a negative price. Don\'t include subtotal/tax/total/payment lines, and never list a bag fee or deposit here if it goes in tip.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Readable English name, e.g. "PC boneless chicken thighs". Expand store abbreviations.',
            },
            original: { type: 'string', description: 'The line as printed, e.g. "PC CHKN THGH BNLS", when it differs from name.' },
            qty: { type: 'number', description: 'Count of this item bought, when the line shows one.' },
            price: { type: 'number', description: 'Line total as printed for this line (qty × unit price), before any tax added at the bottom.' },
            taxable: {
              type: 'boolean',
              description: 'Only when tax is added on top (Canada/US): false for tax-exempt lines (basic groceries are usually zero-rated), true otherwise.',
            },
            size: {
              type: 'string',
              description:
                'Weight or pack size printed on the line, e.g. "1.5 kg", "907 g", "6 pk", or for weighed items "0.840 kg @ $6.58/kg". Leave out when none.',
            },
            code: { type: 'string', description: 'Item code or PLU printed on the line, as printed. Leave out when none.' },
          },
          required: ['name', 'price'],
        },
      },
      subtotal: { type: 'number' },
      tax: {
        type: 'number',
        description:
          'Sales tax ADDED on top of the item prices (sum of GST/HST/PST/state tax lines). Leave out when prices already include tax.',
      },
      tax_included: { type: 'boolean', description: 'True when item prices already include tax (EU VAT shown "incl.").' },
      tip: { type: 'number', description: 'Service charge, bag fee or other amount added after the items. Only here, not also as an item.' },
      total: { type: 'number', description: 'Amount paid.' },
    },
    required: ['readable', 'items'],
  },
} as const;

const PROMPT =
  'Read this grocery receipt. The photo may be sideways, upside down, crumpled or in poor light: read it anyway, and only set readable=false if it is not a receipt at all or the prices cannot be made out. ' +
  'Abbreviations such as "PC CHKN THGH BNLS" should become a readable name ("PC boneless chicken thighs") with the printed text in original. ' +
  'List every item line with its price. For weighed items, price is the printed amount, and size holds the weight and per-kg price (e.g. "0.840 kg @ $6.58/kg"). ' +
  'Note whether tax is added on top (Canada/US style; untaxed lines such as basic groceries are taxable=false) or already included in the prices.';

/**
 * Read a receipt photo (base64 JPEG). The receipt model is tried first, then the extract model if
 * the first is unavailable or gives up. Returns 422 when the photo is not a readable receipt and
 * 502 when no model gave an answer. `fetchImpl` is injectable so tests never reach the network.
 */
export async function parseReceiptImage(
  image: string,
  env: ReceiptEnv,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<ParseResult> {
  const ask = async (model: string): Promise<{ out?: Record<string, unknown>; fail?: string }> => {
    let res: Response;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(90_000),
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 3000,
          tools: [RECEIPT_TOOL],
          tool_choice: { type: 'tool', name: RECEIPT_TOOL.name },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      return { fail: e instanceof Error ? e.message.slice(0, 120) : 'network error' };
    }

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error('receipt parse', model, res.status, detail);
      const message = /"message"\s*:\s*"([^"]+)"/.exec(detail)?.[1] ?? '';
      return { fail: `${res.status} ${message.slice(0, 120)}`.trim() };
    }
    const data = (await res.json()) as { content?: { type: string; input?: Record<string, unknown> }[] };
    const out = data.content?.find((c) => c.type === 'tool_use')?.input;
    return out ? { out } : { fail: 'no tool answer' };
  };

  const models = [...new Set([env.RECEIPT_MODEL || 'claude-sonnet-5-5', env.EXTRACT_MODEL || 'claude-haiku-5-5'])];
  let lastFail = '';
  let unreadable = false;
  for (const model of models) {
    const r = await ask(model);
    if (r.out && r.out.readable !== false) return { ok: true, receipt: r.out };
    if (r.out) unreadable = true;
    else lastFail = r.fail ?? '';
  }
  if (unreadable) return { ok: false, status: 422, message: "That doesn't look like a readable receipt" };
  return { ok: false, status: 502, message: `Couldn't reach the receipt reader (${lastFail || 'no answer'})` };
}
