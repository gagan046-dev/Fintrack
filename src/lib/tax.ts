import { z } from "zod";

export const TAX_SECTIONS = [
  { code: "80C", label: "Section 80C — ELSS, PPF, EPF, LIC, tuition, home loan principal", limitInr: 150000 },
  { code: "80CCD1B", label: "Section 80CCD(1B) — NPS additional", limitInr: 50000 },
  { code: "80D_SELF", label: "Section 80D — Health insurance (self/family, below 60)", limitInr: 25000 },
  { code: "80D_PARENTS", label: "Section 80D — Health insurance (parents below 60)", limitInr: 25000 },
  { code: "80D_SENIOR", label: "Section 80D — Health insurance (senior citizens)", limitInr: 50000 },
  { code: "80E", label: "Section 80E — Education loan interest", limitInr: null },
  { code: "80G", label: "Section 80G — Donations (subject to eligibility)", limitInr: null },
  { code: "80GG", label: "Section 80GG — Rent paid (no HRA)", limitInr: 60000 },
  { code: "80TTA", label: "Section 80TTA — Savings account interest", limitInr: 10000 },
  { code: "80TTB", label: "Section 80TTB — Senior citizen interest", limitInr: 50000 },
  { code: "HRA", label: "House Rent Allowance (component of salary)", limitInr: null },
  { code: "HOME_LOAN_24B", label: "Section 24(b) — Home loan interest (self-occupied)", limitInr: 200000 },
] as const;

export type TaxSectionCode = (typeof TAX_SECTIONS)[number]["code"];

export const taxSectionCodeSchema = z.enum(TAX_SECTIONS.map((section) => section.code) as [TaxSectionCode, ...TaxSectionCode[]]).nullable().optional();

export function financialYearFromDate(date: Date) {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  return month >= 3 ? year : year - 1;
}

export function financialYearRange(startYear: number) {
  return {
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)),
    label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
  };
}

type Regime = "new" | "old";

type SlabResult = { from: number; to: number | null; rate: number; taxableInSlab: number; taxInSlab: number };

export type TaxEstimateInput = {
  regime: Regime;
  financialYearStart: number;
  grossIncome: number;
  standardDeduction?: number;
  hraExemption?: number;
  professionalTax?: number;
  deductions?: {
    "80C"?: number;
    "80CCD1B"?: number;
    "80D_SELF"?: number;
    "80D_PARENTS"?: number;
    "80D_SENIOR"?: number;
    "80E"?: number;
    "80G"?: number;
    "80GG"?: number;
    "80TTA"?: number;
    "80TTB"?: number;
    HOME_LOAN_24B?: number;
  };
};

export type TaxEstimateResult = {
  regime: Regime;
  financialYear: string;
  grossIncome: number;
  standardDeduction: number;
  allowedDeductions: Record<string, { claimed: number; allowed: number }>;
  totalDeductions: number;
  taxableIncome: number;
  slabResults: SlabResult[];
  incomeTax: number;
  rebate87A: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalLiability: number;
  effectiveRatePct: number;
  notes: string[];
};

const NEW_REGIME_SLABS_FY25_26: Array<{ from: number; to: number | null; rate: number }> = [
  { from: 0, to: 400000, rate: 0 },
  { from: 400000, to: 800000, rate: 0.05 },
  { from: 800000, to: 1200000, rate: 0.10 },
  { from: 1200000, to: 1600000, rate: 0.15 },
  { from: 1600000, to: 2000000, rate: 0.20 },
  { from: 2000000, to: 2400000, rate: 0.25 },
  { from: 2400000, to: null, rate: 0.30 },
];

const OLD_REGIME_SLABS: Array<{ from: number; to: number | null; rate: number }> = [
  { from: 0, to: 250000, rate: 0 },
  { from: 250000, to: 500000, rate: 0.05 },
  { from: 500000, to: 1000000, rate: 0.20 },
  { from: 1000000, to: null, rate: 0.30 },
];

function clampDeduction(claimed: number | undefined, limit: number | null) {
  const value = Math.max(0, claimed ?? 0);
  if (limit === null) return { claimed: value, allowed: value };
  return { claimed: value, allowed: Math.min(value, limit) };
}

function applySlabs(taxable: number, slabs: typeof NEW_REGIME_SLABS_FY25_26): { total: number; details: SlabResult[] } {
  let remaining = taxable;
  const details: SlabResult[] = [];
  for (const slab of slabs) {
    if (remaining <= 0) {
      details.push({ from: slab.from, to: slab.to, rate: slab.rate, taxableInSlab: 0, taxInSlab: 0 });
      continue;
    }
    const width = slab.to === null ? remaining : slab.to - slab.from;
    const inSlab = Math.min(remaining, width);
    const tax = inSlab * slab.rate;
    details.push({ from: slab.from, to: slab.to, rate: slab.rate, taxableInSlab: inSlab, taxInSlab: tax });
    remaining -= inSlab;
    if (remaining <= 0) break;
  }
  return { total: details.reduce((sum, item) => sum + item.taxInSlab, 0), details };
}

function surchargeFor(taxable: number, tax: number, regime: Regime) {
  const bands = [
    { threshold: 5_00_00_000, rate: regime === "new" ? 0.25 : 0.37 },
    { threshold: 2_00_00_000, rate: 0.25 },
    { threshold: 1_00_00_000, rate: 0.15 },
    { threshold: 50_00_000, rate: 0.10 },
  ];
  const band = bands.find((entry) => taxable > entry.threshold);
  return band ? tax * band.rate : 0;
}

export function estimateIncomeTax(input: TaxEstimateInput): TaxEstimateResult {
  const regime = input.regime;
  const notes: string[] = [];
  const standardDeductionMax = regime === "new" ? 75000 : 50000;
  const standardDeduction = Math.min(input.standardDeduction ?? standardDeductionMax, standardDeductionMax);

  const professionalTax = regime === "old" ? Math.max(0, input.professionalTax ?? 0) : 0;
  const hraExemption = regime === "old" ? Math.max(0, input.hraExemption ?? 0) : 0;
  if (regime === "new" && (input.hraExemption || input.professionalTax)) {
    notes.push("HRA exemption and professional tax do not apply in the new regime.");
  }

  const allowed: Record<string, { claimed: number; allowed: number }> = {};
  let deductionSum = 0;
  if (regime === "old") {
    const codes: Array<[keyof NonNullable<TaxEstimateInput["deductions"]>, number | null]> = [
      ["80C", 150000],
      ["80CCD1B", 50000],
      ["80D_SELF", 25000],
      ["80D_PARENTS", 25000],
      ["80D_SENIOR", 50000],
      ["80E", null],
      ["80G", null],
      ["80GG", 60000],
      ["80TTA", 10000],
      ["80TTB", 50000],
      ["HOME_LOAN_24B", 200000],
    ];
    for (const [code, limit] of codes) {
      const value = clampDeduction(input.deductions?.[code], limit);
      allowed[code] = value;
      deductionSum += value.allowed;
    }
  } else if (input.deductions && Object.values(input.deductions).some((value) => value && value > 0)) {
    notes.push("Chapter VI-A deductions (80C, 80D, etc.) do not apply in the new regime and were ignored.");
  }

  const taxableIncome = Math.max(0, input.grossIncome - standardDeduction - hraExemption - professionalTax - deductionSum);
  const slabs = regime === "new" ? NEW_REGIME_SLABS_FY25_26 : OLD_REGIME_SLABS;
  const { total: incomeTax, details } = applySlabs(taxableIncome, slabs);

  const rebateLimit = regime === "new" ? 1200000 : 500000;
  const rebateMax = regime === "new" ? 60000 : 12500;
  const rebate87A = taxableIncome <= rebateLimit ? Math.min(incomeTax, rebateMax) : 0;
  const taxAfterRebate = Math.max(0, incomeTax - rebate87A);
  const surcharge = surchargeFor(taxableIncome, taxAfterRebate, regime);
  const cess = (taxAfterRebate + surcharge) * 0.04;
  const totalLiability = Math.round(taxAfterRebate + surcharge + cess);

  return {
    regime,
    financialYear: financialYearRange(input.financialYearStart).label,
    grossIncome: input.grossIncome,
    standardDeduction,
    allowedDeductions: allowed,
    totalDeductions: standardDeduction + hraExemption + professionalTax + deductionSum,
    taxableIncome,
    slabResults: details,
    incomeTax: Math.round(incomeTax),
    rebate87A: Math.round(rebate87A),
    taxAfterRebate: Math.round(taxAfterRebate),
    surcharge: Math.round(surcharge),
    cess: Math.round(cess),
    totalLiability,
    effectiveRatePct: input.grossIncome > 0 ? Math.round((totalLiability / input.grossIncome) * 10000) / 100 : 0,
    notes,
  };
}
