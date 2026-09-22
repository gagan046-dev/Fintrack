import { ApiResponseError, apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { goalUpdateSchema, toGoalDto } from "@/lib/goal-schema";
import { createGoalMilestoneNotifications } from "@/lib/notifications";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: RouteContext<"/api/goals/[id]">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "goals:update");
    const { id } = await params;
    const input = goalUpdateSchema.parse(await request.json());
    const current = await getDb().goal.findFirst({ where: { id, householdId } });
    if (!current) return Response.json({ error: "Goal not found." }, { status: 404 });
    const targetAmount = input.targetAmount ?? current.targetAmount.toString();
    const currentAmount = input.contribution === undefined
      ? input.currentAmount ?? current.currentAmount.toString()
      : String(current.currentAmount.toNumber() + Number(input.contribution));
    if (Number(currentAmount) > Number(targetAmount)) {
      return Response.json({ error: "Current savings cannot exceed the target amount." }, { status: 400 });
    }

    const goal = await getDb().$transaction(async (db) => {
      const updated = await db.goal.updateMany({
        where: { id, householdId, version: input.expectedVersion },
        data: {
          name: input.name,
          targetAmount: input.targetAmount,
          currentAmount,
          targetDate: input.targetDate === undefined ? undefined : input.targetDate ? new Date(`${input.targetDate}T12:00:00.000Z`) : null,
          version: { increment: 1 },
        },
      });
      if (!updated.count) {
        throw new ApiResponseError("This goal changed elsewhere. Review the latest values and try again.", 409);
      }
      await db.auditLog.create({
        data: { householdId, actorId, action: "UPDATE", entityType: "Goal", entityId: id, metadata: input },
      });
      const fresh = await db.goal.findUniqueOrThrow({ where: { id } });
      if (input.contribution !== undefined) await db.goalContribution.create({ data: { householdId, goalId: id, amount: input.contribution, source: "MANUAL", contributedAt: new Date() } });
      if (input.contribution !== undefined) await db.goal.update({ where: { id }, data: { lastContributionAt: new Date() } });
      await createGoalMilestoneNotifications(db, fresh, current.currentAmount.toNumber());
      return fresh;
    });
    return Response.json({ data: toGoalDto(goal) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/goals/[id]">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "goals:delete");
    const { id } = await params;
    const goal = await getDb().goal.findFirst({ where: { id, householdId } });
    if (!goal) return Response.json({ error: "Goal not found." }, { status: 404 });

    await getDb().$transaction(async (db) => {
      await db.goal.delete({ where: { id, householdId } });
      await db.auditLog.create({
        data: { householdId, actorId, action: "DELETE", entityType: "Goal", entityId: id, metadata: { name: goal.name } },
      });
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}