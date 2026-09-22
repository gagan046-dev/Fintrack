import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { toTransactionDto } from "@/lib/transaction-schema";

export async function GET() {
  try {
    const { householdId } = await requireHouseholdContext();
    const transactions = await getDb().transaction.findMany({
      where: { householdId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 100,
    });
    return Response.json({
      data: transactions.map((transaction) => ({
        ...toTransactionDto(transaction),
        deletedAt: transaction.deletedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}