import { z } from 'zod';

// Shopping-list and batch-prep ticks, shared by everyone in the household. One row per week, kind and item.
// The list keys on the ingredient id, prep on the prep step id.

export const CHECK_KINDS = ['list', 'prep'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_ITEM_MAX = 200;
export const CHECK_BULK_MAX = 500;

const CheckItemId = z.string().min(1).max(CHECK_ITEM_MAX);
const CheckMap = z
  .record(CheckItemId, z.boolean())
  .refine((m) => Object.keys(m).length <= CHECK_BULK_MAX, `At most ${CHECK_BULK_MAX} items per kind`);

/** GET /checks/:weekOf. Items never ticked are absent; an item unticked after a tick is false. */
export const ChecksSchema = z.object({
  list: z.record(z.string(), z.boolean()),
  prep: z.record(z.string(), z.boolean()),
  updatedAt: z.string().nullable(),
});
export type Checks = z.infer<typeof ChecksSchema>;

/** PUT /checks/:weekOf: one tick, last write wins. */
export const CheckPutSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  itemId: CheckItemId,
  checked: z.boolean(),
});
export type CheckPut = z.infer<typeof CheckPutSchema>;

/** POST /checks/:weekOf/bulk: a one-time move of ticks saved in a browser. Inserts only where no row exists. */
export const CheckBulkSchema = z.object({
  list: CheckMap.optional(),
  prep: CheckMap.optional(),
});
export type CheckBulk = z.infer<typeof CheckBulkSchema>;
