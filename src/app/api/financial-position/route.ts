import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { annualizeObligation, financialPositionInputSchema } from "@/lib/financial-position-schema";
import { protectMutation } from "@/lib/request-protection";
import { calculatePayoff, captureNetWorthSnapshot } from "@/lib/connected-finance";

const accountTypeToDb = { checking: "CHECKING", savings: "SAVINGS", cash: "CASH", investment: "INVESTMENT" } as const;
const liabilityTypeToDb = { credit_card: "CREDIT_CARD", loan: "LOAN", mortgage: "MORTGAGE", other: "OTHER" } as const;
const frequencyToDb = { weekly: "WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" } as const;

export async function GET() {
  try {
    const { householdId } = await requireHouseholdContext();
    const [accounts, liabilities, recurring] = await Promise.all([
      getDb().account.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
      getDb().liability.findMany({
        where: { householdId },
        orderBy: { createdAt: "asc" },
        include: { payments: { orderBy: { paidAt: "desc" }, take: 12 } },
      }),
      getDb().recurringObligation.findMany({ where: { householdId }, orderBy: [{ active: "desc" }, { nextDueDate: "asc" }] }),
    ]);
    const accountDtos = accounts.map((account) => ({ id: account.id, name: account.name, institution: account.institution, balance: account.balance.toNumber(), type: account.type.toLowerCase() }));
    const liabilityDtos = liabilities.map((liability) => ({
      id: liability.id,
      name: liability.name,
      institution: liability.institution,
      balance: liability.balance.toNumber(),
      interestRate: liability.interestRate?.toNumber() ?? null,
      minimumPayment: liability.minimumPayment?.toNumber() ?? null,
      dueDay: liability.dueDay,
      type: liability.type.toLowerCase(),
      payoff: liability.minimumPayment ? calculatePayoff(liability.balance.toNumber(), liability.interestRate?.toNumber() ?? 0, liability.minimumPayment.toNumber(), liability.dueDay ?? 1) : null,
      payments: liability.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toNumber(),
        principal: payment.principal.toNumber(),
        interest: payment.interest.toNumber(),
        paidAt: payment.paidAt.toISOString(),
      })),
    }));
    const recurringDtos = recurring.map((obligation) => ({
      id: obligation.id,
      name: obligation.name,
      category: obligation.category,
      amount: obligation.amount.toNumber(),
      frequency: obligation.frequency.toLowerCase(),
      nextDueDate: obligation.nextDueDate.toISOString().slice(0, 10),
      active: obligation.active,
    }));
    const totalAssets = accountDtos.reduce((sum, account) => sum + account.balance, 0);
    const totalLiabilities = liabilityDtos.reduce((sum, liability) => sum + liability.balance, 0);
    const annualRecurring = recurring.filter((item) => item.active).reduce((sum, item) => sum + annualizeObligation(item.amount.toNumber(), item.frequency), 0);

    return Response.json({
      data: {
        accounts: accountDtos,
        liabilities: liabilityDtos,
        recurring: recurringDtos,
        summary: {
          totalAssets,
          totalLiabilities,
          netWorth: totalAssets - totalLiabilities,
          monthlyRecurring: annualRecurring / 12,
        },
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "financial-position:create", { limit: 30, windowSeconds: 60 });
    const input = financialPositionInputSchema.parse(await request.json());
    const created = await getDb().$transaction(async (db) => {
      const entity = input.kind === "account"
        ? await db.account.create({ data: { householdId, ...input.data, openingBalance: input.data.balance, type: accountTypeToDb[input.data.type] } })
        : input.kind === "liability"
          ? await db.liability.create({ data: { householdId, ...input.data, type: liabilityTypeToDb[input.data.type] } })
          : await db.recurringObligation.create({ data: { householdId, ...input.data, frequency: frequencyToDb[input.data.frequency], nextDueDate: new Date(`${input.data.nextDueDate}T12:00:00.000Z`) } });
      await db.auditLog.create({
        data: { householdId, actorId, action: "CREATE", entityType: input.kind, entityId: entity.id },
      });
      if (input.kind === "liability" && input.data.dueDay) await db.reminderSchedule.create({ data: { householdId, entityType: "LIABILITY", liabilityId: entity.id, daysBeforeDue: 3 } });
      if (input.kind === "recurring") await db.reminderSchedule.create({ data: { householdId, entityType: "RECURRING_OBLIGATION", obligationId: entity.id, daysBeforeDue: 3 } });
      if (input.kind === "account" || input.kind === "liability") await captureNetWorthSnapshot(db, householdId);
      return entity;
    });
    return Response.json({ data: { id: created.id } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}