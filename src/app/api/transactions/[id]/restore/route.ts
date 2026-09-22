import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { syncBudgetAlerts } from "@/lib/notifications";
import { toTransactionDto } from "@/lib/transaction-schema";
import { protectMutation } from "@/lib/request-protection";
import { captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";

export async function POST(request: Request, { params }: RouteContext<"/api/transactions/[id]/restore">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:restore");
    const { id } = await params;
    const transaction = await getDb().$transaction(async (db) => {
      const restoredCount = await db.transaction.updateMany({ where: { id, householdId, deletedAt: { not: null } }, data: { deletedAt: null } });
      if (!restoredCount.count) return null;
      const restored = await db.transaction.findUniqueOrThrow({ where: { id } });
      await db.auditLog.create({
        data: { householdId, actorId, action: "RESTORE", entityType: "Transaction", entityId: id, metadata: { merchant: restored.merchant } },
      });
      if (restored.type === "EXPENSE") {
        await syncBudgetAlerts(db, householdId, restored.transactionAt, [restored.category]);
      }
      await reconcileAccountBalance(db, householdId, restored.accountId);
      await captureNetWorthSnapshot(db, householdId);
      return restored;
    });
    if (!transaction) return Response.json({ error: "Deleted transaction not found." }, { status: 404 });
    return Response.json({ data: toTransactionDto(transaction) });
  } catch (error) {
    return apiError(error);
  }
}