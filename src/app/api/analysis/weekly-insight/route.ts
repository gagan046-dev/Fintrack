import { openrouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const { householdId, currency } = await requireHouseholdContext();
    const now = new Date();
    const currentStart = new Date(now.getTime() - 7 * 86_400_000);
    const previousStart = new Date(now.getTime() - 14 * 86_400_000);
    const monthlyStart = new Date(now.getTime() - 30 * 86_400_000);

    const [current, previous, monthly, largestExpense, topCategories, activeSubs] = await Promise.all([
      getDb().transaction.groupBy({
        by: ["type"],
        where: { householdId, deletedAt: null, transactionAt: { gte: currentStart, lte: now } },
        _sum: { amount: true },
        _count: true,
      }),
      getDb().transaction.groupBy({
        by: ["type"],
        where: { householdId, deletedAt: null, transactionAt: { gte: previousStart, lt: currentStart } },
        _sum: { amount: true },
      }),
      getDb().transaction.aggregate({
        where: { householdId, deletedAt: null, transactionAt: { gte: monthlyStart, lte: now }, type: "EXPENSE" },
        _sum: { amount: true },
        _count: true,
      }),
      getDb().transaction.findFirst({
        where: { householdId, deletedAt: null, transactionAt: { gte: currentStart, lte: now }, type: "EXPENSE" },
        orderBy: { amount: "desc" },
        select: { merchant: true, amount: true, category: true },
      }),
      getDb().transaction.groupBy({
        by: ["category"],
        where: { householdId, deletedAt: null, transactionAt: { gte: currentStart, lte: now }, type: "EXPENSE" },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 3,
      }),
      getDb().subscription.count({ where: { householdId, status: "ACTIVE" } }),
    ]);

    const num = (item: (typeof current)[number] | (typeof previous)[number] | undefined) => item?._sum.amount?.toNumber() ?? 0;
    const currentExpense = num(current.find((row) => row.type === "EXPENSE"));
    const currentIncome = num(current.find((row) => row.type === "INCOME"));
    const previousExpense = num(previous.find((row) => row.type === "EXPENSE"));
    const previousIncome = num(previous.find((row) => row.type === "INCOME"));
    const transactionCount = current.reduce((sum, row) => sum + row._count, 0);
    const monthlyExpense = monthly._sum.amount?.toNumber() ?? 0;
    const monthlyCount = monthly._count;

    const spendChangePct = previousExpense > 0 ? Math.round(((currentExpense - previousExpense) / previousExpense) * 100) : null;
    const incomeChangePct = previousIncome > 0 ? Math.round(((currentIncome - previousIncome) / previousIncome) * 100) : null;
    const avgDailyExpense = monthlyExpense / 30;

    const facts = {
      currency,
      window: "last 7 days",
      currentExpense: Math.round(currentExpense * 100) / 100,
      previousExpense: Math.round(previousExpense * 100) / 100,
      spendChangePct,
      currentIncome: Math.round(currentIncome * 100) / 100,
      incomeChangePct,
      transactionCount,
      monthlyExpense: Math.round(monthlyExpense * 100) / 100,
      monthlyTransactionCount: monthlyCount,
      avgDailyExpense: Math.round(avgDailyExpense * 100) / 100,
      activeSubscriptions: activeSubs,
      largestExpense: largestExpense ? { merchant: largestExpense.merchant.slice(0, 80), amount: largestExpense.amount.toNumber(), category: largestExpense.category.slice(0, 60) } : null,
      topCategories: topCategories.map((row) => ({ category: row.category.slice(0, 60), amount: row._sum.amount?.toNumber() ?? 0 })),
    };

    let narrative: string;
    if (!process.env.OPENROUTER_API_KEY?.trim() || transactionCount === 0) {
      narrative = transactionCount === 0
        ? "No transactions were recorded in the last 7 days. Add some transactions to unlock weekly insights."
        : `You logged ${transactionCount} transactions this week. Spending was ${currency} ${currentExpense.toFixed(2)}${spendChangePct !== null ? ` (${spendChangePct >= 0 ? "up" : "down"} ${Math.abs(spendChangePct)}% vs prior week)` : ""}. Top category: ${topCategories[0]?.category ?? "n/a"}.`;
    } else {
      try {
        const result = await generateText({
          model: openrouter(process.env.OPENROUTER_MODEL ?? "nvidia/llama-3.1-nemotron-ultra-253b-v1:free"),
          instructions: "Write a 2-3 sentence weekly spending recap from the supplied JSON facts. Be factual and concise. Never invent numbers. Do not give investment, credit, tax, legal, or purchase advice. Use the provided currency symbol prefix. Plain text only.",
          prompt: JSON.stringify(facts),
          maxOutputTokens: 220,
          maxRetries: 1,
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        });
        narrative = result.text.trim().slice(0, 600);
      } catch {
        narrative = `You logged ${transactionCount} transactions this week. Spending was ${currency} ${currentExpense.toFixed(2)}${spendChangePct !== null ? ` (${spendChangePct >= 0 ? "up" : "down"} ${Math.abs(spendChangePct)}% vs prior week)` : ""}.`;
      }
    }

    return Response.json({ data: { facts, narrative } }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return apiError(error);
  }
}
