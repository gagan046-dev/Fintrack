import type { Prisma } from "@/generated/prisma/client";

type NotificationPreference = "budgetAlerts" | "goalAlerts";
type NotificationKind = "BUDGET_WARNING" | "BUDGET_EXCEEDED" | "GOAL_MILESTONE" | "SYSTEM";

export async function notifyHousehold(
  db: Prisma.TransactionClient,
  input: {
    householdId: string;
    type: NotificationKind;
    title: string;
    message: string;
    dedupeKey: string;
    preference?: NotificationPreference;
  },
) {
  const memberships = await db.membership.findMany({
    where: { householdId: input.householdId },
    include: { user: { include: { preferences: true } } },
  });
  const recipients = memberships.filter((membership) => {
    if (!input.preference) return true;
    return membership.user.preferences?.[input.preference] ?? true;
  });
  if (!recipients.length) return;
  await db.notification.createMany({
    data: recipients.map((membership) => ({
      userId: membership.userId,
      householdId: input.householdId,
      type: input.type,
      title: input.title,
      message: input.message,
      dedupeKey: input.dedupeKey,
    })),
    skipDuplicates: true,
  });
}

export async function syncBudgetAlerts(
  db: Prisma.TransactionClient,
  householdId: string,
  transactionAt: Date,
  categories?: string[],
) {
  const monthStart = new Date(Date.UTC(transactionAt.getUTCFullYear(), transactionAt.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(transactionAt.getUTCFullYear(), transactionAt.getUTCMonth() + 1, 1));
  const budgets = await db.budget.findMany({
    where: { householdId, month: monthStart, category: categories?.length ? { in: categories } : undefined },
  });
  if (!budgets.length) return;
  const spending = await db.transaction.groupBy({
    by: ["category"],
    where: {
      householdId,
      deletedAt: null,
      type: "EXPENSE",
      category: { in: budgets.map((budget) => budget.category) },
      transactionAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  });
  const spendingByCategory = new Map(spending.map((item) => [item.category, item._sum.amount?.toNumber() ?? 0]));
  const month = monthStart.toISOString().slice(0, 7);
  for (const budget of budgets) {
    const spent = spendingByCategory.get(budget.category) ?? 0;
    const ratio = spent / budget.amount.toNumber();
    if (ratio < 0.8) continue;
    const exceeded = ratio >= 1;
    await notifyHousehold(db, {
      householdId,
      type: exceeded ? "BUDGET_EXCEEDED" : "BUDGET_WARNING",
      title: exceeded ? `${budget.category} budget exceeded` : `${budget.category} budget at 80%`,
      message: `${spent.toFixed(2)} spent against a ${budget.amount.toNumber().toFixed(2)} monthly limit.`,
      dedupeKey: `budget:${month}:${budget.category}:${exceeded ? "100" : "80"}`,
      preference: "budgetAlerts",
    });
  }
}

export async function createGoalMilestoneNotifications(
  db: Prisma.TransactionClient,
  goal: { id: string; householdId: string; name: string; targetAmount: { toNumber(): number }; currentAmount: { toNumber(): number } },
  previousAmount: number,
) {
  const target = goal.targetAmount.toNumber();
  const previousPercentage = target ? (previousAmount / target) * 100 : 0;
  const currentPercentage = target ? (goal.currentAmount.toNumber() / target) * 100 : 0;
  for (const milestone of [50, 75, 100]) {
    if (previousPercentage >= milestone || currentPercentage < milestone) continue;
    await notifyHousehold(db, {
      householdId: goal.householdId,
      type: "GOAL_MILESTONE",
      title: milestone === 100 ? `${goal.name} completed` : `${goal.name} reached ${milestone}%`,
      message: milestone === 100 ? "You reached this savings goal." : `Your savings progress reached ${milestone}% of the target.`,
      dedupeKey: `goal:${goal.id}:${milestone}`,
      preference: "goalAlerts",
    });
  }
}