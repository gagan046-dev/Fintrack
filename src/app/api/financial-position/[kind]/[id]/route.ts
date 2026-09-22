import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { financialPositionKindSchema, financialPositionUpdateSchema } from "@/lib/financial-position-schema";
import { protectMutation } from "@/lib/request-protection";
import { captureNetWorthSnapshot, setReportedAccountBalance } from "@/lib/connected-finance";

const accountTypeToDb = { checking: "CHECKING", savings: "SAVINGS", cash: "CASH", investment: "INVESTMENT" } as const;
const liabilityTypeToDb = { credit_card: "CREDIT_CARD", loan: "LOAN", mortgage: "MORTGAGE", other: "OTHER" } as const;
const frequencyToDb = { weekly: "WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" } as const;

type FinancialPositionRouteContext = { params: Promise<{ kind: string; id: string }> };

export async function PATCH(request: Request, { params }: FinancialPositionRouteContext) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "financial-position:update", { limit: 60, windowSeconds: 60 });
    const { kind: rawKind, id } = await params;
    const kind = financialPositionKindSchema.parse(rawKind);
    const input = financialPositionUpdateSchema.parse({ kind, data: await request.json() });
    const updated = await getDb().$transaction(async (db) => {
      let entity: { id: string } | null = null;
      if (input.kind === "account") {
        const existing = await db.account.findFirst({ where: { id, householdId }, select: { id: true } });
        if (!existing) return null;
        const { type, ...data } = input.data;
        const { balance, ...accountData } = data;
        entity = balance === undefined
          ? await db.account.update({ where: { id, householdId }, data: { ...accountData, type: type ? accountTypeToDb[type] : undefined } })
          : await setReportedAccountBalance(db, householdId, id, Number(balance));
        if (Object.keys(accountData).length || type) entity = await db.account.update({ where: { id, householdId }, data: { ...accountData, type: type ? accountTypeToDb[type] : undefined } });
      } else if (input.kind === "liability") {
        const existing = await db.liability.findFirst({ where: { id, householdId }, select: { id: true } });
        if (!existing) return null;
        const { type, ...data } = input.data;
        entity = await db.liability.update({ where: { id, householdId }, data: { ...data, type: type ? liabilityTypeToDb[type] : undefined } });
      } else {
        const existing = await db.recurringObligation.findFirst({ where: { id, householdId }, select: { id: true } });
        if (!existing) return null;
        const { frequency, nextDueDate, ...data } = input.data;
        entity = await db.recurringObligation.update({ where: { id, householdId }, data: { ...data, frequency: frequency ? frequencyToDb[frequency] : undefined, nextDueDate: nextDueDate ? new Date(`${nextDueDate}T12:00:00.000Z`) : undefined } });
      }
      await db.auditLog.create({ data: { householdId, actorId, action: "UPDATE", entityType: kind, entityId: id } });
      if (kind === "account" || kind === "liability") await captureNetWorthSnapshot(db, householdId);
      return entity;
    });
    if (!updated) return Response.json({ error: "Financial record not found." }, { status: 404 });
    return Response.json({ data: { id: updated.id } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: FinancialPositionRouteContext) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "financial-position:delete", { limit: 30, windowSeconds: 60 });
    const { kind: rawKind, id } = await params;
    const kind = financialPositionKindSchema.parse(rawKind);
    const deleted = await getDb().$transaction(async (db) => {
      const result = kind === "account"
        ? await db.account.deleteMany({ where: { id, householdId } })
        : kind === "liability"
          ? await db.liability.deleteMany({ where: { id, householdId } })
          : await db.recurringObligation.deleteMany({ where: { id, householdId } });
      if (!result.count) return false;
      await db.auditLog.create({ data: { householdId, actorId, action: "DELETE", entityType: kind, entityId: id } });
      if (kind === "account" || kind === "liability") await captureNetWorthSnapshot(db, householdId);
      return true;
    });
    if (!deleted) return Response.json({ error: "Financial record not found." }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}