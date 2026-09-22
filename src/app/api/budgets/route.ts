import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { budgetInputSchema, budgetQuerySchema, getBudgetMonthRange, getCurrentBudgetMonth } from "@/lib/budget-schema";
import { getDb } from "@/lib/db";
import { syncBudgetAlerts } from "@/lib/notifications";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { householdId } = await requireHouseholdContext();
    const url = new URL(request.url);
    const query = budgetQuerySchema.parse(Object.fromEntries(url.searchParams));
    const month = query.month ?? getCurrentBudgetMonth();
    const { start, end } = getBudgetMonthRange(month);

    const [budgets, spending] = await Promise.all([
      getDb().budget.findMany({
        where: { householdId, month: start },
        orderBy: { category: "asc" },
      }),
      getDb().transaction.groupBy({
        by: ["category"],
        where: {
          householdId,
          deletedAt: null,
          type: "EXPENSE",
          transactionAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
    ]);
    const spendingByCategory = new Map(spending.map((item) => [item.category, item._sum.amount?.toNumber() ?? 0]));

    return Response.json({
      data: budgets.map((budget) => {
        const spent = spendingByCategory.get(budget.category) ?? 0;
        const baseAmount = budget.amount.toNumber();
        const rolloverAmount = budget.rolloverAmount.toNumber();
        const amount = baseAmount + rolloverAmount;
        return {
          id: budget.id,
          category: budget.category,
          amount,
          baseAmount,
          rolloverAmount,
          month,
          spent,
          remaining: amount - spent,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "budgets:write");
    const input = budgetInputSchema.parse(await request.json());
    const { start } = getBudgetMonthRange(input.month);

    const result = await getDb().$transaction(async (db) => {
      const existing = await db.budget.findUnique({
        where: { householdId_category_month: { householdId, category: input.category, month: start } },
        select: { id: true },
      });
      const budget = await db.budget.upsert({
        where: { householdId_category_month: { householdId, category: input.category, month: start } },
        update: { amount: input.amount },
        create: { householdId, category: input.category, amount: input.amount, month: start },
      });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: existing ? "UPDATE" : "CREATE",
          entityType: "Budget",
          entityId: budget.id,
          metadata: { category: input.category, amount: input.amount, month: input.month },
        },
      });
      await syncBudgetAlerts(db, householdId, start, [input.category]);
      return { budget, created: !existing };
    });

    return Response.json({
      data: {
        id: result.budget.id,
        category: result.budget.category,
        amount: result.budget.amount.toNumber(),
        month: input.month,
      },
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}