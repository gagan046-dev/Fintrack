"use client";

import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { FormEvent } from "react";
import { useCurrencyFormatter } from "@/components/currency-context";

type TransactionDraft = {
  id: number | string;
  description: string;
  merchant: string;
  category: string;
  paymentType: string;
  amount: number;
  type: "expense" | "income";
  date: string;
  accountId?: string | null;
};

type AccountOption = { id: string; name: string };

export function TransactionEditor({
  transaction,
  accounts,
  onClose,
  onSaved,
}: {
  transaction: TransactionDraft | null;
  accounts: AccountOption[];
  onClose: () => void;
  onSaved: (transaction: TransactionDraft) => void;
}) {
  const { currencySymbol } = useCurrencyFormatter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      description: String(form.get("description")),
      merchant: String(form.get("merchant")),
      category: String(form.get("category")),
      paymentType: String(form.get("paymentType")),
      amount: Number(form.get("amount")),
      type: form.get("type") as "expense" | "income",
      date: String(form.get("date")),
      accountId: String(form.get("accountId") || "") || null,
      source: "manual",
    };
    const editing = typeof transaction?.id === "string";
    const response = await fetch(editing ? `/api/transactions/${transaction.id}` : "/api/transactions", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(editing ? {} : { externalId: `manual:${crypto.randomUUID()}` }) }),
    });
    if (!response.ok) return;
    const result = await response.json() as { data: TransactionDraft };
    onSaved(result.data);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="transaction-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-kicker">{transaction ? "Update activity" : "New activity"}</span>
            <h2>{transaction ? "Edit transaction" : "Add transaction"}</h2>
            <p>Linked account balances update automatically.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <form key={String(transaction?.id ?? "new")} onSubmit={submit}>
          <div className="type-toggle">
            <label><input type="radio" name="type" value="expense" defaultChecked={transaction?.type !== "income"} /><span><ArrowUpRight size={16} /> Expense</span></label>
            <label><input type="radio" name="type" value="income" defaultChecked={transaction?.type === "income"} /><span><ArrowDownLeft size={16} /> Income</span></label>
          </div>
          <label className="form-field amount-field"><span>Amount</span><div><b>{currencySymbol}</b><input name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction?.amount} required autoFocus /></div></label>
          <div className="form-grid">
            <label className="form-field"><span>Merchant or source</span><input name="merchant" defaultValue={transaction?.merchant} required /></label>
            <label className="form-field"><span>Category</span><input name="category" defaultValue={transaction?.category ?? "Food"} required /></label>
          </div>
          <label className="form-field"><span>Description</span><textarea name="description" defaultValue={transaction?.description} rows={3} required /></label>
          <div className="form-grid">
            <label className="form-field"><span>Payment type</span><input name="paymentType" defaultValue={transaction?.paymentType ?? "Bank account"} required /></label>
            <label className="form-field"><span>Account</span><select name="accountId" defaultValue={transaction?.accountId ?? ""}><option value="">Unassigned</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
          </div>
          <label className="form-field"><span>Date</span><input name="date" type="date" defaultValue={transaction?.date ?? new Date().toISOString().slice(0, 10)} required /></label>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{transaction ? "Update" : "Save"} transaction</button></div>
        </form>
      </section>
    </div>
  );
}
