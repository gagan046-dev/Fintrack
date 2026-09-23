import { clerkClient } from "@clerk/nextjs/server";
import { apiError } from "@/lib/api-response";
import { getBudgetMonthRange } from "@/lib/budget-schema";
import { getDb } from "@/lib/db";
import { notifyHousehold } from "@/lib/notifications";
import { captureNetWorthSnapshot, reconcileAccountBalance } from "@/lib/connected-finance";

function advanceRenewalDate(from: Date, frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY") {
  const next = new Date(from);
  if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1);
  else if (frequency === "QUARTERLY") next.setUTCMonth(next.getUTCMonth() + 3);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const now = new Date();
    const { start } = getBudgetMonthRange(now.toISOString().slice(0, 7));
    const households = await getDb().household.findMany({ select: { id: true } });
    let budgetsCreated = 0;
    let remindersGenerated = 0;
    let subscriptionsRenewed = 0;
    for (const household of households) {
      const accountsTouched = new Set<string>();
      await getDb().$transaction(async (db) => {
        const templates = await db.budgetTemplate.findMany({ where: { householdId: household.id, active: true, startMonth: { lte: start } } });
        for (const template of templates) {
          const offset = (start.getUTCFullYear() - template.startMonth.getUTCFullYear()) * 12 + start.getUTCMonth() - template.startMonth.getUTCMonth();
          const due = template.recurrence === "MONTHLY" || template.recurrence === "QUARTERLY" && offset % 3 === 0 || template.recurrence === "YEARLY" && offset % 12 === 0;
          if (!due) continue;
          const created = await db.budget.createMany({ data: [{ householdId: household.id, category: template.category, amount: template.amount, month: start, templateId: template.id }], skipDuplicates: true });
          budgetsCreated += created.count;
        }
        const schedules = await db.reminderSchedule.findMany({ where: { householdId: household.id, active: true }, include: { liability: true, obligation: true, subscription: true } });
        for (const schedule of schedules) {
          const entity = schedule.liability ?? schedule.obligation ?? schedule.subscription;
          if (!entity) continue;
          let dueDate = schedule.obligation?.nextDueDate ?? schedule.subscription?.renewalDate;
          if (schedule.liability?.dueDay) {
            dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(schedule.liability.dueDay, 28)));
            if (dueDate < now) dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);
          }
          if (!dueDate) continue;
          const days = Math.ceil((dueDate.getTime() - now.getTime()) / 86_400_000);
          if (days < 0 || days > schedule.daysBeforeDue) continue;
          await notifyHousehold(db, { householdId: household.id, type: "SYSTEM", title: `${entity.name} due soon`, message: `${entity.name} is due in ${days} day${days === 1 ? "" : "s"}.`, dedupeKey: `due:${schedule.id}:${dueDate.toISOString().slice(0, 10)}` });
          remindersGenerated += 1;
        }
        const dueSubs = await db.subscription.findMany({ where: { householdId: household.id, status: "ACTIVE", renewalDate: { lte: now } } });
        if (dueSubs.length) {
          const defaultAccount = await db.account.findFirst({ where: { householdId: household.id, type: { in: ["CHECKING", "SAVINGS"] } }, orderBy: { createdAt: "asc" } });
          for (const sub of dueSubs) {
            const chargedAt = new Date(sub.renewalDate);
            await db.transaction.create({
              data: {
                householdId: household.id,
                accountId: defaultAccount?.id ?? null,
                description: `${sub.name} subscription renewal`,
                merchant: sub.vendor,
                category: sub.category,
                paymentType: "Subscription",
                amount: sub.amount,
                type: "EXPENSE",
                source: "MANUAL",
                transactionAt: chargedAt,
                externalId: `subscription:${sub.id}:${chargedAt.toISOString().slice(0, 10)}`,
              },
            });
            await db.subscriptionEvent.create({ data: { householdId: household.id, subscriptionId: sub.id, action: "UPDATED", reason: "auto_renewal" } });
            const nextRenewal = advanceRenewalDate(sub.renewalDate, sub.frequency);
            await db.subscription.update({ where: { id: sub.id }, data: { renewalDate: nextRenewal } });
            if (defaultAccount) accountsTouched.add(defaultAccount.id);
            subscriptionsRenewed += 1;
          }
        }
      });
      for (const accountId of accountsTouched) {
        await getDb().$transaction(async (db) => {
          await reconcileAccountBalance(db, household.id, accountId, now);
          await captureNetWorthSnapshot(db, household.id, now);
        });
      }
    }
    let deletionsCompleted = 0;
    const dueDeletions = await getDb().accountDeletionRequest.findMany({ where: { status: "PENDING", executeAfter: { lte: now } }, include: { user: true } });
    for (const deletion of dueDeletions) {
      if (deletion.user.authSubject) {
        try { const client = await clerkClient(); await client.users.deleteUser(deletion.user.authSubject); } catch { continue; }
      }
      await getDb().$transaction(async (db) => {
        await db.accountDeletionRequest.update({ where: { id: deletion.id }, data: { status: "COMPLETED" } });
        await db.user.delete({ where: { id: deletion.userId } });
      });
      deletionsCompleted += 1;
    }
    await getDb().rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
    return Response.json({ budgetsCreated, remindersGenerated, subscriptionsRenewed, deletionsCompleted });
  } catch (error) {
    return apiError(error);
  }
}
