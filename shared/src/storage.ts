// What storage the household has: containers, a freezer, zip bags. Prep plans use only what is listed here.
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

export const StorageSchema = z.object({
  containers: z.enum(CONTAINER_LEVELS),
  freezer: z.boolean(),
  zipBags: z.boolean(),
});
export type Storage = z.infer<typeof StorageSchema>;

export const DEFAULT_STORAGE: Storage = { containers: 'some', freezer: true, zipBags: true };
