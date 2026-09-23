import { z } from "zod";
import { TAX_SECTIONS } from "@/lib/tax";

const transactionType = z.enum(["expense", "income"]);
const transactionSource = z.enum(["manual", "csv_import", "xlsx_import", "bank_api", "email_receipt"]);
const taxSectionCodes = TAX_SECTIONS.map((section) => section.code) as [string, ...string[]];
const taxSection = z.enum(taxSectionCodes).nullable().optional();
const moneyAmount = z.union([z.number().finite(), z.string().trim()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Use a positive amount with no more than two decimal places."))
  .refine((value) => Number(value) > 0, "Amount must be greater than zero.");

export const transactionInputSchema = z.object({
  description: z.string().trim().min(2).max(500),
  merchant: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  paymentType: z.string().trim().min(1).max(80),
  amount: moneyAmount,
  type: transactionType,
  source: transactionSource.default("manual"),
  date: z.iso.date(),
  accountId: z.string().trim().min(1).nullable().optional(),
  externalId: z.string().trim().max(255).nullable().optional(),
  taxSection,
});

export const transactionUpdateSchema = transactionInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required.",
);

const importedTransactionSchema = transactionInputSchema.extend({
  externalId: z.string().trim().min(1).max(255),
});

export const transactionImportSchema = z.object({
  transactions: z.array(importedTransactionSchema).min(1).max(1000),
});

export const transactionQuerySchema = z.object({
  query: z.string().trim().max(160).optional(),
  category: z.string().trim().max(80).optional(),
  type: transactionType.optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const transactionTypeToDb = { expense: "EXPENSE", income: "INCOME" } as const;
const transactionSourceToDb = {
  manual: "MANUAL",
  csv_import: "CSV_IMPORT",
  xlsx_import: "XLSX_IMPORT",
  bank_api: "BANK_API",
  email_receipt: "EMAIL_RECEIPT",
} as const;

export function toTransactionCreateData(input: z.infer<typeof transactionInputSchema>) {
  return {
    description: input.description,
    merchant: input.merchant,
    category: input.category,
    paymentType: input.paymentType,
    amount: input.amount,
    type: transactionTypeToDb[input.type],
    source: transactionSourceToDb[input.source],
    transactionAt: new Date(`${input.date}T12:00:00.000Z`),
    accountId: input.accountId ?? null,
    externalId: input.externalId ?? null,
    taxSection: input.taxSection ?? null,
  };
}

export function toTransactionDto(transaction: {
  id: string;
  description: string;
  merchant: string;
  category: string;
  paymentType: string;
  amount: { toNumber(): number };
  type: "EXPENSE" | "INCOME";
  source: "MANUAL" | "CSV_IMPORT" | "XLSX_IMPORT" | "BANK_API" | "EMAIL_RECEIPT";
  transactionAt: Date;
  createdAt: Date;
  updatedAt: Date;
  accountId: string | null;
  taxSection?: string | null;
}) {
  return {
    id: transaction.id,
    description: transaction.description,
    merchant: transaction.merchant,
    category: transaction.category,
    paymentType: transaction.paymentType,
    amount: transaction.amount.toNumber(),
    type: transaction.type.toLowerCase(),
    source: transaction.source.toLowerCase(),
    date: transaction.transactionAt.toISOString().slice(0, 10),
    accountId: transaction.accountId,
    taxSection: transaction.taxSection ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}