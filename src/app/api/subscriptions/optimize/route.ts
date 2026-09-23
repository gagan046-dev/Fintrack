import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const { householdId } = await requireHouseholdContext();
    const now = new Date();
    const lookbackDays = 90;
    const lookbackStart = new Date(now.getTime() - lookbackDays * 86_400_000);

    const subscriptions = await getDb().subscription.findMany({
      where: { householdId, status: { in: ["ACTIVE", "PAUSED"] } },
      include: { events: { orderBy: { occurredAt: "desc" }, take: 20 } },
    });

    const monthlyCost = subscriptions
      .filter((sub) => sub.status === "ACTIVE")
      .reduce((sum, sub) => {
        const amount = sub.amount.toNumber();
        const monthly = sub.frequency === "WEEKLY" ? amount * 52 / 12 : sub.frequency === "MONTHLY" ? amount : sub.frequency === "QUARTERLY" ? amount / 3 : amount / 12;
        return sum + monthly;
      }, 0);

    const suggestions: Array<{
      subscriptionId: string;
      name: string;
      vendor: string;
      category: string;
      monthlyCost: number;
      reason: string;
      severity: "high" | "medium" | "low";
      potentialSavingsMonthly: number;
    }> = [];

    for (const sub of subscriptions) {
      const amount = sub.amount.toNumber();
      const monthly = sub.frequency === "WEEKLY" ? amount * 52 / 12 : sub.frequency === "MONTHLY" ? amount : sub.frequency === "QUARTERLY" ? amount / 3 : amount / 12;

      const activityCount = await getDb().transaction.count({
        where: {
          householdId,
          deletedAt: null,
          transactionAt: { gte: lookbackStart },
          OR: [
            { category: { equals: sub.category, mode: "insensitive" } },
            { merchant: { contains: sub.vendor, mode: "insensitive" } },
          ],
          NOT: { externalId: { startsWith: `subscription:${sub.id}:` } },
        },
      });

      const autoRenewals = sub.events.filter((event) => event.reason === "auto_renewal").length;
      const paused = sub.status === "PAUSED";
      const dormant = activityCount === 0 && autoRenewals >= 2;
      const lowActivity = activityCount > 0 && activityCount < 3 && autoRenewals >= 3 && monthly >= 300;

      if (paused) {
        suggestions.push({
          subscriptionId: sub.id,
          name: sub.name,
          vendor: sub.vendor,
          category: sub.category,
          monthlyCost: monthly,
          reason: "This subscription is paused. If you don't plan to resume it, cancel it to keep the list tidy.",
          severity: "low",
          potentialSavingsMonthly: 0,
        });
      } else if (dormant) {
        suggestions.push({
          subscriptionId: sub.id,
          name: sub.name,
          vendor: sub.vendor,
          category: sub.category,
          monthlyCost: monthly,
          reason: `You've been charged for ${autoRenewals} cycle${autoRenewals === 1 ? "" : "s"} but no matching activity was recorded in the last ${lookbackDays} days.`,
          severity: monthly >= 500 ? "high" : "medium",
          potentialSavingsMonthly: monthly,
        });
      } else if (lowActivity) {
        suggestions.push({
          subscriptionId: sub.id,
          name: sub.name,
          vendor: sub.vendor,
          category: sub.category,
          monthlyCost: monthly,
          reason: `Only ${activityCount} related transaction${activityCount === 1 ? "" : "s"} in ${lookbackDays} days despite ${autoRenewals} renewals — review whether the plan still fits your usage.`,
          severity: "medium",
          potentialSavingsMonthly: monthly * 0.5,
        });
      }
    }

    suggestions.sort((a, b) => b.potentialSavingsMonthly - a.potentialSavingsMonthly);

    return Response.json({
      data: {
        totalMonthlyCost: Math.round(monthlyCost * 100) / 100,
        activeCount: subscriptions.filter((sub) => sub.status === "ACTIVE").length,
        pausedCount: subscriptions.filter((sub) => sub.status === "PAUSED").length,
        lookbackDays,
        suggestions,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
