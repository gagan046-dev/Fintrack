import type { Prisma } from "@/generated/prisma/client";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { syncBudgetAlerts } from "@/lib/notifications";
import { protectMutation } from "@/lib/request-protection";
import { assertHouseholdAccount, captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";
import { transactionInputSchema, transactionQuerySchema, toTransactionCreateData, toTransactionDto } from "@/lib/transaction-schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { householdId } = await requireHouseholdContext();
    const url = new URL(request.url);
    const query = transactionQuerySchema.parse(Object.fromEntries(url.searchParams));
    const where: Prisma.TransactionWhereInput = {
      householdId,
      deletedAt: null,
      category: query.category,
      type: query.type?.toUpperCase() as Prisma.EnumTransactionTypeFilter | undefined,
      OR: query.query ? [
        { merchant: { contains: query.query, mode: "insensitive" } },
        { description: { contains: query.query, mode: "insensitive" } },
        { paymentType: { contains: query.query, mode: "insensitive" } },
      ] : undefined,
    };
    if (query.cursor) {
      const cursorExists = await getDb().transaction.findFirst({
        where: { id: query.cursor, householdId, deletedAt: null },
        select: { id: true },
      });
      if (!cursorExists) {
        return Response.json({ error: "Invalid transaction cursor." }, { status: 400 });
      }
    }
    const transactions = await getDb().transaction.findMany({
      where,
      orderBy: [{ transactionAt: "desc" }, { createdAt: "desc" }],
      take: query.limit + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
    });
    const hasMore = transactions.length > query.limit;
    const page = hasMore ? transactions.slice(0, -1) : transactions;

    return Response.json({
      data: page.map(toTransactionDto),
      nextCursor: hasMore ? page.at(-1)?.id : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:create");
    const input = transactionInputSchema.parse(await request.json());
    const transaction = await getDb().$transaction(async (db) => {
      await assertHouseholdAccount(db, householdId, input.accountId);
      const created = await db.transaction.create({
        data: {
          householdId,
          ...toTransactionCreateData(input),
        },
      });
      await db.auditLog.create({
        data: {
          householdId,
          actorId,
          action: "CREATE",
          entityType: "Transaction",
          entityId: created.id,
          metadata: { source: input.source },
        },
      });
      if (created.type === "EXPENSE") {
        await syncBudgetAlerts(db, householdId, created.transactionAt, [created.category]);
      }
      await reconcileAccountBalance(db, householdId, created.accountId, created.transactionAt);
      await captureNetWorthSnapshot(db, householdId, created.transactionAt);
      return created;
    });

    return Response.json({ data: toTransactionDto(transaction) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}