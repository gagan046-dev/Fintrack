import { z } from "zod";

const moneyAmount = z.union([z.number().finite(), z.string().trim()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Use an amount with no more than two decimal places."));

export const goalInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  targetAmount: moneyAmount.refine((value) => Number(value) > 0, "Target amount must be greater than zero."),
  currentAmount: moneyAmount.default("0"),
  targetDate: z.iso.date().nullable().optional(),
}).refine((goal) => Number(goal.currentAmount) <= Number(goal.targetAmount), {
  message: "Current savings cannot exceed the target amount.",
  path: ["currentAmount"],
});

export const goalUpdateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  name: z.string().trim().min(2).max(120).optional(),
  targetAmount: moneyAmount.refine((value) => Number(value) > 0, "Target amount must be greater than zero.").optional(),
  currentAmount: moneyAmount.optional(),
  contribution: moneyAmount.refine((value) => Number(value) > 0, "Contribution must be greater than zero.").optional(),
  targetDate: z.iso.date().nullable().optional(),
}).refine((goal) => Object.keys(goal).some((key) => key !== "expectedVersion"), "At least one goal field is required.")
  .refine((goal) => goal.currentAmount === undefined || goal.contribution === undefined, "Use currentAmount or contribution, not both.");

export function toGoalDto(goal: {
  id: string;
  name: string;
  targetAmount: { toNumber(): number };
  currentAmount: { toNumber(): number };
  targetDate: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount.toNumber(),
    currentAmount: goal.currentAmount.toNumber(),
    targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
    version: goal.version,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}