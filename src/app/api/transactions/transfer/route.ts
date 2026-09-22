import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { assertHouseholdAccount, captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";
import { toTransactionDto } from "@/lib/transaction-schema";

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.coerce.number().positive().multipleOf(0.01),
  date: z.iso.date(),
  description: z.string().trim().max(200).optional(),
}).refine((value) => value.fromAccountId !== value.toAccountId, "Transfer accounts must be different.");

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:transfer", { limit: 30, windowSeconds: 60 });
    const input = transferSchema.parse(await request.json());
    const date = new Date(`${input.date}T12:00:00.000Z`);
    const result = await getDb().$transaction(async (db) => {
      await Promise.all([assertHouseholdAccount(db, householdId, input.fromAccountId), assertHouseholdAccount(db, householdId, input.toAccountId)]);
      const transfer = await db.transactionTransfer.create({ data: { householdId, fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount: input.amount.toFixed(2), description: input.description, transferredAt: date } });
      const common = { householdId, transferId: transfer.id, merchant: "Internal Transfer", category: "Transfer", paymentType: "Account transfer", amount: input.amount.toFixed(2), source: "MANUAL" as const, transactionAt: date };
      const outgoing = await db.transaction.create({ data: { ...common, accountId: input.fromAccountId, description: input.description ?? "Transfer out", type: "EXPENSE", externalId: `transfer:${transfer.id}:out:${randomUUID()}` } });
      const incoming = await db.transaction.create({ data: { ...common, accountId: input.toAccountId, description: input.description ?? "Transfer in", type: "INCOME", externalId: `transfer:${transfer.id}:in:${randomUUID()}` } });
      await reconcileAccountBalance(db, householdId, input.fromAccountId, date);
      await reconcileAccountBalance(db, householdId, input.toAccountId, date);
      await captureNetWorthSnapshot(db, householdId, date);
      await db.auditLog.create({ data: { householdId, actorId, action: "CREATE", entityType: "TransactionTransfer", entityId: transfer.id, metadata: { fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount: input.amount } } });
      return { transfer, outgoing, incoming };
    });
    return Response.json({ data: { id: result.transfer.id, transactions: [toTransactionDto(result.outgoing), toTransactionDto(result.incoming)] } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}