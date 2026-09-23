import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { protectMutation } from "@/lib/request-protection";
import { estimateIncomeTax } from "@/lib/tax";

const nonNegative = z.coerce.number().finite().min(0).max(1_000_000_000).default(0);

const requestSchema = z.object({
  regime: z.enum(["new", "old"]),
  financialYearStart: z.coerce.number().int().min(2015).max(2100),
  grossIncome: z.coerce.number().finite().min(0).max(1_000_000_000),
  standardDeduction: nonNegative.optional(),
  hraExemption: nonNegative.optional(),
  professionalTax: nonNegative.optional(),
  deductions: z.object({
    "80C": nonNegative.optional(),
    "80CCD1B": nonNegative.optional(),
    "80D_SELF": nonNegative.optional(),
    "80D_PARENTS": nonNegative.optional(),
    "80D_SENIOR": nonNegative.optional(),
    "80E": nonNegative.optional(),
    "80G": nonNegative.optional(),
    "80GG": nonNegative.optional(),
    "80TTA": nonNegative.optional(),
    "80TTB": nonNegative.optional(),
    HOME_LOAN_24B: nonNegative.optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    const { actorId } = await requireHouseholdContext();
    await protectMutation(request, actorId, "tax-estimator", { limit: 30, windowSeconds: 60 });
    const input = requestSchema.parse(await request.json());
    const result = estimateIncomeTax(input);
    return Response.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
