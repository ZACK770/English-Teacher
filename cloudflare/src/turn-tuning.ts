import { z } from "zod";

export const TurnTuningSchema = z.object({
  energyThreshold: z.number().int().min(400).max(4000).default(1200),
  minSoundMs: z.number().int().min(200).max(1200).default(500),
  resumeSilenceMs: z.number().int().min(200).max(1000).default(420),
}).strict();
export type TurnTuning = z.infer<typeof TurnTuningSchema>;
export const DEFAULT_TURN_TUNING: TurnTuning = TurnTuningSchema.parse({});
export function resolveTurnTuning(value?: Partial<TurnTuning>): TurnTuning {
  return TurnTuningSchema.parse(value ?? {});
}
