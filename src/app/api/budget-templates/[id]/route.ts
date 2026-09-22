import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ amount: z.coerce.number().positive().multipleOf(.01).optional(), rollover: z.boolean().optional(), active: z.boolean().optional(), recurrence: z.enum(["monthly", "quarterly", "yearly"]).optional() }).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, { params }: Context) {
  try { const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "budgets:template"); const { id } = await params; const input = schema.parse(await request.json()); const updated = await getDb().$transaction(async (db) => { const result = await db.budgetTemplate.updateMany({ where: { id, householdId }, data: { amount: input.amount?.toFixed(2), rollover: input.rollover, active: input.active, recurrence: input.recurrence?.toUpperCase() as "MONTHLY" | "QUARTERLY" | "YEARLY" | undefined } }); if (!result.count) return false; await db.auditLog.create({ data: { householdId, actorId, action: "UPDATE", entityType: "BudgetTemplate", entityId: id, metadata: input } }); return true; }); return updated ? Response.json({ data: { id } }) : Response.json({ error: "Budget template not found." }, { status: 404 }); } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try { const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "budgets:template-delete"); const { id } = await params; const updated = await getDb().budgetTemplate.updateMany({ where: { id, householdId }, data: { active: false } }); return updated.count ? new Response(null, { status: 204 }) : Response.json({ error: "Budget template not found." }, { status: 404 }); } catch (error) { return apiError(error); }
}