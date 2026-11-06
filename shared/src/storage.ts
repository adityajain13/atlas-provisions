// What storage the household has: containers, a freezer space, ziplock bags, and ziplock bags for the freezer.
// Prep plans use only what is listed here.
import { z } from 'zod';

export const CONTAINER_LEVELS = ['none', 'few', 'some', 'plenty'] as const;
export type ContainerLevel = (typeof CONTAINER_LEVELS)[number];

/** The labels the Household screen shows for each level: none, 1 to 3, 4 to 8, plenty. */
export const CONTAINER_LABEL: Record<ContainerLevel, string> = {
  none: 'None',
  few: '1–3',
  some: '4–8',
  plenty: 'Plenty',
};

const StorageObject = z.object({
  containers: z.enum(CONTAINER_LEVELS),
  freezer: z.boolean(),
  zipBags: z.boolean(),
  freezerBags: z.boolean(),
});

/**
 * Storage as saved. A household stored before freezerBags existed gets its zipBags value (or true when there is none),
 * since the old zip bags were the ones it used for the freezer too.
 */
export const StorageSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || (raw as { freezerBags?: unknown }).freezerBags !== undefined) return raw;
  const zip = (raw as { zipBags?: unknown }).zipBags;
  return { ...(raw as object), freezerBags: typeof zip === 'boolean' ? zip : true };
}, StorageObject);
export type Storage = z.infer<typeof StorageObject>;

export const DEFAULT_STORAGE: Storage = { containers: 'some', freezer: true, zipBags: true, freezerBags: true };
