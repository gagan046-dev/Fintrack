import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ApiResponseError } from "@/lib/api-response";
import { calculateDebtProjection } from "@/lib/debt-projection";

export async function assertHouseholdAccount(db: Prisma.TransactionClient, householdId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const account = await db.account.findFirst({ where: { id: accountId, householdId } });
  if (!account) throw new ApiResponseError("Account not found in the active household.", 404);
  return account;
}

export async function reconcileAccountBalance(db: Prisma.TransactionClient, householdId: string, accountId: string | null | undefined, recordedAt = new Date()) {
  const account = await assertHouseholdAccount(db, householdId, accountId);
  if (!account) return null;
  const totals = await db.transaction.groupBy({
    by: ["type"],
    where: { householdId, accountId: account.id, deletedAt: null },
    _sum: { amount: true },
  });
  const income = totals.find((item) => item.type === "INCOME")?._sum.amount?.toNumber() ?? 0;
  const expenses = totals.find((item) => item.type === "EXPENSE")?._sum.amount?.toNumber() ?? 0;
  const balance = account.openingBalance.toNumber() + income - expenses;
  const updated = await db.account.update({
    where: { id: account.id, householdId },
    data: { balance: balance.toFixed(2), version: { increment: 1 } },
  });
  await db.accountBalanceSnapshot.create({ data: { householdId, accountId: account.id, balance: updated.balance, recordedAt } });
  return updated;
}

export async function setReportedAccountBalance(db: Prisma.TransactionClient, householdId: string, accountId: string, balance: number) {
  const account = await assertHouseholdAccount(db, householdId, accountId);
  if (!account) throw new ApiResponseError("Account not found.", 404);
  const totals = await db.transaction.groupBy({
    by: ["type"],
    where: { householdId, accountId, deletedAt: null },
    _sum: { amount: true },
  });
  const income = totals.find((item) => item.type === "INCOME")?._sum.amount?.toNumber() ?? 0;
  const expenses = totals.find((item) => item.type === "EXPENSE")?._sum.amount?.toNumber() ?? 0;
  const openingBalance = balance - income + expenses;
  const updated = await db.account.update({
    where: { id: accountId, householdId },
    data: { balance: balance.toFixed(2), openingBalance: openingBalance.toFixed(2), version: { increment: 1 } },
  });
  await db.accountBalanceSnapshot.create({ data: { householdId, accountId, balance: updated.balance } });
  return updated;
}

export async function captureNetWorthSnapshot(db: Prisma.TransactionClient, householdId: string, recordedAt = new Date()) {
  const [assets, debts] = await Promise.all([
    db.account.aggregate({ where: { householdId }, _sum: { balance: true } }),
    db.liability.aggregate({ where: { householdId }, _sum: { balance: true } }),
  ]);
  const totalAssets = assets._sum.balance?.toNumber() ?? 0;
  const totalLiabilities = debts._sum.balance?.toNumber() ?? 0;
  const snapshotDate = new Date(Date.UTC(recordedAt.getUTCFullYear(), recordedAt.getUTCMonth(), recordedAt.getUTCDate()));
  const values = {
    totalAssets: totalAssets.toFixed(2),
    totalLiabilities: totalLiabilities.toFixed(2),
    netWorth: (totalAssets - totalLiabilities).toFixed(2),
  };
  return db.netWorthSnapshot.upsert({
    where: { householdId_recordedAt: { householdId, recordedAt: snapshotDate } },
    update: values,
    create: { householdId, recordedAt: snapshotDate, ...values },
  });
}

export function calculatePayoff(balance: number, annualRate: number, monthlyPayment: number, dueDay = 1) {
  const { months, totalInterest, projectedPayoffDate } = calculateDebtProjection(
    balance,
    annualRate,
    monthlyPayment,
    dueDay,
  );
  return { months, totalInterest, projectedPayoffDate };
}

export async function recordLiabilityPayment(db: Prisma.TransactionClient, input: { householdId: string; liabilityId: string; amount: number; paidAt: Date }) {
  const liability = await db.liability.findFirst({ where: { id: input.liabilityId, householdId: input.householdId } });
  if (!liability) throw new ApiResponseError("Liability not found.", 404);
  const monthlyRate = (liability.interestRate?.toNumber() ?? 0) / 100 / 12;
  const interest = Math.min(input.amount, liability.balance.toNumber() * monthlyRate);
  const principal = Math.min(liability.balance.toNumber(), input.amount - interest);
  const payment = await db.liabilityPayment.create({
    data: { householdId: input.householdId, liabilityId: liability.id, amount: input.amount.toFixed(2), principal: principal.toFixed(2), interest: interest.toFixed(2), paidAt: input.paidAt },
  });
  await db.liability.update({ where: { id: liability.id, householdId: input.householdId }, data: { balance: { decrement: principal.toFixed(2) } } });
  await captureNetWorthSnapshot(db, input.householdId, input.paidAt);
  return payment;
}

function inferFrequency(dates: Date[]) {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
  const gaps = sorted.slice(1).map((date, index) => (date.getTime() - sorted[index].getTime()) / 86_400_000);
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const candidates = [
    { frequency: "WEEKLY" as const, days: 7 },
    { frequency: "MONTHLY" as const, days: 30.44 },
    { frequency: "QUARTERLY" as const, days: 91.31 },
    { frequency: "YEARLY" as const, days: 365.25 },
  ];
  const match = candidates.map((candidate) => ({ ...candidate, deviation: Math.abs(average - candidate.days) / candidate.days })).sort((a, b) => a.deviation - b.deviation)[0];
  return match.deviation <= 0.28 ? { frequency: match.frequency, confidence: Math.max(0.5, 1 - match.deviation) } : null;
}

export async function detectRecurringPatterns(db: Prisma.TransactionClient, householdId: string) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 18);
  const transactions = await db.transaction.findMany({
    where: { householdId, deletedAt: null, type: "EXPENSE", transactionAt: { gte: since } },
    orderBy: { transactionAt: "asc" },
  });
  const groups = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const key = `${transaction.merchant.trim().toLowerCase()}|${transaction.category.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  const patterns = [];
  for (const group of groups.values()) {
    const inferred = inferFrequency(group.map((item) => item.transactionAt));
    if (!inferred) continue;
    const averageAmount = group.reduce((sum, item) => sum + item.amount.toNumber(), 0) / group.length;
    const sample = group[0];
    const pattern = await db.recurringPattern.upsert({
      where: { householdId_merchant_category_frequency: { householdId, merchant: sample.merchant, category: sample.category, frequency: inferred.frequency } },
      update: { averageAmount: averageAmount.toFixed(2), confidence: inferred.confidence.toFixed(4), lastDetectedAt: new Date() },
      create: { householdId, merchant: sample.merchant, category: sample.category, frequency: inferred.frequency, averageAmount: averageAmount.toFixed(2), confidence: inferred.confidence.toFixed(4) },
    });
    await db.transaction.updateMany({ where: { id: { in: group.map((item) => item.id) }, householdId }, data: { isRecurring: true, recurringPatternId: pattern.id } });
    patterns.push(pattern);
  }
  return patterns;
}

export function nextOccurrence(date: Date, frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY") {
  const next = new Date(date);
  if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1);
  if (frequency === "QUARTERLY") next.setUTCMonth(next.getUTCMonth() + 3);
  if (frequency === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}
