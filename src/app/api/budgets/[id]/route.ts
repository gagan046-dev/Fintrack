import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: RouteContext<"/api/budgets/[id]">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "budgets:delete");
    const { id } = await params;
    const budget = await getDb().budget.findFirst({ where: { id, householdId } });
    if (!budget) return Response.json({ error: "Budget not found." }, { status: 404 });

    await getDb().$transaction(async (db) => {
      await db.budget.delete({ where: { id, householdId } });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: "DELETE",
          entityType: "Budget",
          entityId: id,
          metadata: { category: budget.category, amount: budget.amount.toString() },
        },
      });
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}