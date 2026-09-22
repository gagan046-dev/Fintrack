import { z } from "zod";

const moneyAmount = z.union([z.number().finite(), z.string().trim()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Use a non-negative amount with no more than two decimal places."));

const accountDataSchema = z.object({
  name: z.string().trim().min(2).max(120),
  institution: z.string().trim().max(120).nullable().optional(),
  type: z.enum(["checking", "savings", "cash", "investment"]),
  balance: moneyAmount,
});

const liabilityDataSchema = z.object({
  name: z.string().trim().min(2).max(120),
  institution: z.string().trim().max(120).nullable().optional(),
  type: z.enum(["credit_card", "loan", "mortgage", "other"]),
  balance: moneyAmount,
  interestRate: z.coerce.number().min(0).max(100).nullable().optional(),
  minimumPayment: moneyAmount.nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
});

const recurringDataSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(80),
  amount: moneyAmount.refine((value) => Number(value) > 0, "Amount must be greater than zero."),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  nextDueDate: z.iso.date(),
  active: z.boolean().default(true),
});

export const financialPositionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), data: accountDataSchema }),
  z.object({ kind: z.literal("liability"), data: liabilityDataSchema }),
  z.object({ kind: z.literal("recurring"), data: recurringDataSchema }),
]);

export const financialPositionUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), data: accountDataSchema.partial().refine((data) => Object.keys(data).length > 0) }),
  z.object({ kind: z.literal("liability"), data: liabilityDataSchema.partial().refine((data) => Object.keys(data).length > 0) }),
  z.object({ kind: z.literal("recurring"), data: recurringDataSchema.partial().refine((data) => Object.keys(data).length > 0) }),
]);

export const financialPositionKindSchema = z.enum(["account", "liability", "recurring"]);

export function annualizeObligation(amount: number, frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY") {
  const multiplier = { WEEKLY: 52, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 }[frequency];
  return amount * multiplier;
}