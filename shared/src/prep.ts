import { z } from 'zod';
import { DAYS } from './calendar';

// Batch prep for one day of the week (milestone 3B). The planner model writes the steps; the
// worker validates them against the plan's meal ids before saving.

export const PrepStepSchema = z.object({
  id: z.string().min(1),
  task: z.string().trim().min(1).max(200),
  minutes: z.number().int().min(0).max(480),
  forMeals: z.array(z.string()), // meal ids from the plan this step serves
  storage: z.string().trim().max(200).optional(),
});
export type PrepStep = z.infer<typeof PrepStepSchema>;

export const PrepPlanSchema = z.object({
  day: z.enum(DAYS),
  steps: z.array(PrepStepSchema),
  totalMinutes: z.number().int().min(0),
});
export type PrepPlan = z.infer<typeof PrepPlanSchema>;

/** What the model returns through the submit_prep tool, before ids and totals are added. */
export const RawPrepSchema = z.object({
  day: z.enum(DAYS).optional(),
  steps: z
    .array(
      z.object({
        task: z.string().trim().min(1).max(200),
        minutes: z.number().min(0).max(480),
        forMeals: z.array(z.string()),
        storage: z.string().trim().max(200).optional(),
      }),
    )
    .max(30),
});
export type RawPrep = z.infer<typeof RawPrepSchema>;
