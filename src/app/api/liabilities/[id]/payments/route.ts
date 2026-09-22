import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { calculatePayoff, recordLiabilityPayment } from "@/lib/connected-finance";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

type Context = { params: Promise<{ id: string }> };
const paymentSchema = z.object({ amount: z.coerce.number().positive().multipleOf(0.01), paidAt: z.iso.date().default(() => new Date().toISOString().slice(0, 10)) });

export async function GET(_request: Request, { params }: Context) {
  try {
    const { householdId } = await requireHouseholdContext(); const { id } = await params;
    const liability = await getDb().liability.findFirst({ where: { id, householdId }, include: { payments: { orderBy: { paidAt: "desc" }, take: 100 } } });
    if (!liability) return Response.json({ error: "Liability not found." }, { status: 404 });
    const payoff = liability.minimumPayment ? calculatePayoff(liability.balance.toNumber(), liability.interestRate?.toNumber() ?? 0, liability.minimumPayment.toNumber(), liability.dueDay ?? 1) : null;
    return Response.json({ data: { payoff, payments: liability.payments.map((item) => ({ id: item.id, amount: item.amount.toNumber(), principal: item.principal.toNumber(), interest: item.interest.toNumber(), paidAt: item.paidAt.toISOString() })) } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "liabilities:payment");
    const { id } = await params; const input = paymentSchema.parse(await request.json());
    const payment = await getDb().$transaction(async (db) => {
      const created = await recordLiabilityPayment(db, { householdId, liabilityId: id, amount: input.amount, paidAt: new Date(`${input.paidAt}T12:00:00.000Z`) });
      await db.auditLog.create({ data: { householdId, actorId, action: "CREATE", entityType: "LiabilityPayment", entityId: created.id, metadata: { liabilityId: id, amount: input.amount } } });
      return created;
    });
    return Response.json({ data: { id: payment.id } }, { status: 201 });
  } catch (error) { return apiError(error); }
}