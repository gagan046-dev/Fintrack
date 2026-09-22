import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { syncBudgetAlerts } from "@/lib/notifications";
import { protectMutation } from "@/lib/request-protection";
import { assertHouseholdAccount, captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";
import { transactionUpdateSchema, toTransactionCreateData, toTransactionDto } from "@/lib/transaction-schema";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: RouteContext<"/api/transactions/[id]">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:update");
    const { id } = await params;
    const input = transactionUpdateSchema.parse(await request.json());
    const current = await getDb().transaction.findFirst({ where: { id, householdId, deletedAt: null } });
    if (!current) return Response.json({ error: "Transaction not found." }, { status: 404 });

    const normalized = {
      description: input.description ?? current.description,
      merchant: input.merchant ?? current.merchant,
      category: input.category ?? current.category,
      paymentType: input.paymentType ?? current.paymentType,
      amount: input.amount ?? current.amount.toString(),
      type: input.type ?? current.type.toLowerCase() as "expense" | "income",
      source: input.source ?? current.source.toLowerCase() as "manual" | "csv_import" | "xlsx_import" | "bank_api" | "email_receipt",
      date: input.date ?? current.transactionAt.toISOString().slice(0, 10),
      accountId: input.accountId === undefined ? current.accountId : input.accountId,
      externalId: input.externalId === undefined ? current.externalId : input.externalId,
    };
    const transaction = await getDb().$transaction(async (db) => {
      await assertHouseholdAccount(db, householdId, normalized.accountId);
      const updated = await db.transaction.update({
        where: { id, householdId, deletedAt: null },
        data: toTransactionCreateData(normalized),
      });
      await db.auditLog.create({ data: { householdId, actorId, action: "UPDATE", entityType: "Transaction", entityId: id } });
      if (updated.type === "EXPENSE") {
        await syncBudgetAlerts(db, householdId, updated.transactionAt, [updated.category]);
      }
      await reconcileAccountBalance(db, householdId, current.accountId, updated.transactionAt);
      if (updated.accountId !== current.accountId) await reconcileAccountBalance(db, householdId, updated.accountId, updated.transactionAt);
      await captureNetWorthSnapshot(db, householdId, updated.transactionAt);
      return updated;
    });

    return Response.json({ data: toTransactionDto(transaction) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/transactions/[id]">) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:delete");
    const { id } = await params;
    const current = await getDb().transaction.findFirst({ where: { id, householdId, deletedAt: null } });
    if (!current) return Response.json({ error: "Transaction not found." }, { status: 404 });

    await getDb().$transaction(async (db) => {
      await db.transaction.update({ where: { id, householdId, deletedAt: null }, data: { deletedAt: new Date() } });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: "DELETE",
          entityType: "Transaction",
          entityId: id,
          metadata: { merchant: current.merchant, amount: current.amount.toString() },
        },
      });
      await reconcileAccountBalance(db, householdId, current.accountId);
      await captureNetWorthSnapshot(db, householdId);
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}