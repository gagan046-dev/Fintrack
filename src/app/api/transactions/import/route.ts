import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { syncBudgetAlerts } from "@/lib/notifications";
import { protectMutation } from "@/lib/request-protection";
import { assertHouseholdAccount, captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";
import { transactionImportSchema, toTransactionCreateData, toTransactionDto } from "@/lib/transaction-schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:import", { limit: 10, windowSeconds: 60 });
    const { transactions } = transactionImportSchema.parse(await request.json());
    const externalIds = transactions.flatMap((transaction) => transaction.externalId ? [transaction.externalId] : []);

    const imported = await getDb().$transaction(async (db) => {
      const existing = await db.transaction.findMany({
        where: { householdId, externalId: { in: externalIds } },
        select: { id: true, externalId: true },
      });
      const existingExternalIds = new Set(existing.flatMap((transaction) => transaction.externalId ? [transaction.externalId] : []));
      const pending = transactions.filter((transaction) => !existingExternalIds.has(transaction.externalId));
      for (const transaction of pending) await assertHouseholdAccount(db, householdId, transaction.accountId);
      const created = await db.transaction.createMany({
        data: pending.map((transaction) => ({
          householdId,
          ...toTransactionCreateData(transaction),
        })),
        skipDuplicates: true,
      });
      const saved = await db.transaction.findMany({
        where: {
          householdId,
          deletedAt: null,
          externalId: { in: externalIds },
        },
        orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }],
      });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: "IMPORT",
          entityType: "Transaction",
          entityId: "batch",
          metadata: { requested: transactions.length, created: created.count, duplicates: transactions.length - created.count },
        },
      });
      const alertGroups = new Map<string, { date: Date; categories: Set<string> }>();
      for (const transaction of saved.filter((item) => item.type === "EXPENSE")) {
        const month = transaction.transactionAt.toISOString().slice(0, 7);
        const group = alertGroups.get(month) ?? { date: transaction.transactionAt, categories: new Set<string>() };
        group.categories.add(transaction.category);
        alertGroups.set(month, group);
      }
      for (const group of alertGroups.values()) {
        await syncBudgetAlerts(db, householdId, group.date, [...group.categories]);
      }
      const affectedAccounts = [...new Set(saved.flatMap((transaction) => transaction.accountId ? [transaction.accountId] : []))];
      for (const accountId of affectedAccounts) await reconcileAccountBalance(db, householdId, accountId);
      if (affectedAccounts.length) await captureNetWorthSnapshot(db, householdId);
      return {
        saved,
        duplicates: existing.map((transaction) => ({ externalId: transaction.externalId, existingId: transaction.id })),
        created: created.count,
      };
    });

    return Response.json({
      data: imported.saved.map(toTransactionDto),
      duplicates: imported.duplicates,
      metadata: { requested: transactions.length, created: imported.created, duplicates: transactions.length - imported.created },
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}