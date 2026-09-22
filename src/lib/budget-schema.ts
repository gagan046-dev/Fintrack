import { z } from "zod";

const moneyAmount = z.union([z.number().finite(), z.string().trim()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Use a positive amount with no more than two decimal places."))
  .refine((value) => Number(value) > 0, "Amount must be greater than zero.");

export const budgetInputSchema = z.object({
  category: z.string().trim().min(1).max(80),
  amount: moneyAmount,
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "Use a month in YYYY-MM format."),
});

export const budgetQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).optional(),
});

export function getBudgetMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

export function getCurrentBudgetMonth() {
  return new Date().toISOString().slice(0, 7);
}