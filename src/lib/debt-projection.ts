export type EmiScheduleEntry = {
  installment: number;
  dueDate: Date;
  openingBalance: number;
  payment: number;
  principal: number;
  interest: number;
  closingBalance: number;
};

export type DebtProjection = {
  months: number | null;
  totalInterest: number | null;
  projectedPayoffDate: Date | null;
  schedule: EmiScheduleEntry[];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function installmentDate(asOf: Date, dueDay: number, installment: number) {
  const firstMonthOffset = asOf.getUTCDate() <= dueDay ? 0 : 1;
  const monthStart = new Date(
    Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth() + firstMonthOffset + installment - 1,
      1,
      12,
    ),
  );
  const lastDay = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      monthStart.getUTCFullYear(),
      monthStart.getUTCMonth(),
      Math.min(dueDay, lastDay),
      12,
    ),
  );
}

export function calculateDebtProjection(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  dueDay = 1,
  scheduleLength = 6,
  asOf = new Date(),
): DebtProjection {
  if (
    !Number.isFinite(balance) ||
    !Number.isFinite(annualRate) ||
    !Number.isFinite(monthlyPayment) ||
    balance < 0 ||
    annualRate < 0 ||
    monthlyPayment <= 0
  ) {
    return { months: null, totalInterest: null, projectedPayoffDate: null, schedule: [] };
  }

  if (balance === 0) {
    return { months: 0, totalInterest: 0, projectedPayoffDate: asOf, schedule: [] };
  }

  const monthlyRate = annualRate / 100 / 12;
  if (monthlyPayment <= balance * monthlyRate) {
    return { months: null, totalInterest: null, projectedPayoffDate: null, schedule: [] };
  }

  const schedule: EmiScheduleEntry[] = [];
  let remaining = balance;
  let totalInterest = 0;
  let months = 0;

  while (remaining > 0.005 && months < 600) {
    const openingBalance = remaining;
    const interest = openingBalance * monthlyRate;
    const payment = Math.min(monthlyPayment, openingBalance + interest);
    const principal = payment - interest;
    remaining = Math.max(0, openingBalance - principal);
    months += 1;
    totalInterest += interest;

    if (schedule.length < scheduleLength) {
      schedule.push({
        installment: months,
        dueDate: installmentDate(asOf, dueDay, months),
        openingBalance: roundMoney(openingBalance),
        payment: roundMoney(payment),
        principal: roundMoney(principal),
        interest: roundMoney(interest),
        closingBalance: roundMoney(remaining),
      });
    }
  }

  if (remaining > 0.005) {
    return { months: null, totalInterest: null, projectedPayoffDate: null, schedule };
  }

  return {
    months,
    totalInterest: roundMoney(totalInterest),
    projectedPayoffDate: installmentDate(asOf, dueDay, months),
    schedule,
  };
}