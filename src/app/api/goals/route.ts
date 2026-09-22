import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { goalInputSchema, toGoalDto } from "@/lib/goal-schema";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { householdId } = await requireHouseholdContext();
    const goals = await getDb().goal.findMany({
      where: { householdId },
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ data: goals.map(toGoalDto) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "goals:create");
    const input = goalInputSchema.parse(await request.json());
    const goal = await getDb().$transaction(async (db) => {
      const created = await db.goal.create({
        data: {
          householdId,
          name: input.name,
          targetAmount: input.targetAmount,
          currentAmount: input.currentAmount,
          targetDate: input.targetDate ? new Date(`${input.targetDate}T12:00:00.000Z`) : null,
        },
      });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: "CREATE",
          entityType: "Goal",
          entityId: created.id,
          metadata: { name: input.name, targetAmount: input.targetAmount },
        },
      });
      if (Number(input.currentAmount) > 0) await db.goalContribution.create({ data: { householdId, goalId: created.id, amount: input.currentAmount, source: "MANUAL", contributedAt: new Date() } });
      return created;
    });
    return Response.json({ data: toGoalDto(goal) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}