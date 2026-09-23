"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Info, Landmark, PieChart as PieIcon, ReceiptText, RotateCcw, Save, Sparkles } from "lucide-react";
import { useCurrencyFormatter } from "@/components/currency-context";

type TaxSummaryEntry = {
  code: string;
  label: string;
  limitInr: number | null;
  claimed: number;
  allowed: number;
  utilizationPct: number | null;
  transactionCount: number;
};

type TaxSummary = {
  year: number;
  financialYearLabel: string;
  from: string;
  to: string;
  totalClaimed: number;
  totalAllowed: number;
  summary: TaxSummaryEntry[];
};

type SlabResult = { from: number; to: number | null; rate: number; taxableInSlab: number; taxInSlab: number };

type EstimateResult = {
  regime: "new" | "old";
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

const DEDUCTION_INPUTS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "80C", label: "Section 80C", hint: "ELSS, PPF, EPF, LIC, tuition, home loan principal — limit ₹1.5L" },
  { key: "80CCD1B", label: "Section 80CCD(1B)", hint: "NPS additional — limit ₹50k" },
  { key: "80D_SELF", label: "Section 80D (self/family)", hint: "Health insurance — limit ₹25k" },
  { key: "80D_PARENTS", label: "Section 80D (parents)", hint: "Health insurance — limit ₹25k" },
  { key: "80D_SENIOR", label: "Section 80D (senior)", hint: "Health insurance senior — limit ₹50k" },
  { key: "80E", label: "Section 80E", hint: "Education loan interest — no limit" },
  { key: "80G", label: "Section 80G", hint: "Donations (subject to eligibility)" },
  { key: "80TTA", label: "Section 80TTA", hint: "Savings account interest — limit ₹10k" },
  { key: "HOME_LOAN_24B", label: "Section 24(b)", hint: "Home loan interest (self-occupied) — limit ₹2L" },
];

function formatCurrencyInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

export function TaxPlanningWorkspace() {
  const { currency } = useCurrencyFormatter();
  const [year, setYear] = useState<number | null>(null);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [regime, setRegime] = useState<"new" | "old">("new");
  const [grossIncome, setGrossIncome] = useState("");
  const [hraExemption, setHraExemption] = useState("");
  const [professionalTax, setProfessionalTax] = useState("");
  const [deductions, setDeductions] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);

  const yearOptions = useMemo(() => {
    const today = new Date();
    const currentFy = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [currentFy + 1, currentFy, currentFy - 1, currentFy - 2].filter((value) => value >= 2019);
  }, []);

  useEffect(() => {
    let active = true;
    const target = year ?? yearOptions[1] ?? yearOptions[0];
    const query = target ? `?year=${target}` : "";
    void fetch(`/api/tax-summary${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in to view tax planning." : "Tax summary could not be loaded.");
        return response.json() as Promise<{ data: TaxSummary }>;
      })
      .then((result) => {
        if (!active) return;
        setSummary(result.data);
        setSummaryError("");
        if (year === null) setYear(result.data.year);
      })
      .catch((error: Error) => { if (active) setSummaryError(error.message); });
    return () => { active = false; };
  }, [year, yearOptions]);

  useEffect(() => {
    if (!summary) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeductions((current) => {
      const next = { ...current };
      for (const entry of summary.summary) {
        if (!next[entry.code] && entry.allowed > 0) {
          next[entry.code] = String(Math.round(entry.allowed));
        }
      }
      return next;
    });
  }, [summary]);

  async function runEstimate() {
    setEstimating(true);
    setEstimateError("");
    try {
      const payload = {
        regime,
        financialYearStart: year ?? yearOptions[1] ?? yearOptions[0],
        grossIncome: Number(grossIncome) || 0,
        hraExemption: regime === "old" ? Number(hraExemption) || 0 : 0,
        professionalTax: regime === "old" ? Number(professionalTax) || 0 : 0,
        deductions: regime === "old" ? Object.fromEntries(Object.entries(deductions).map(([key, value]) => [key, Number(value) || 0])) : {},
      };
      const response = await fetch("/api/tax-estimator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in required." : "Tax estimate could not be calculated.");
      const result = await response.json() as { data: EstimateResult };
      setEstimate(result.data);
    } catch (error) {
      setEstimateError(error instanceof Error ? error.message : "Tax estimate failed.");
    } finally {
      setEstimating(false);
    }
  }

  function fillFromLedger() {
    if (!summary) return;
    const map: Record<string, string> = {};
    for (const entry of summary.summary) map[entry.code] = String(Math.round(entry.allowed));
    setDeductions(map);
  }

  return (
    <section className="tax-workspace">
      <div className="tax-disclaimer"><Info size={14} /><span>Educational estimator only, based on published FY 2025–26 slabs. Not a tax return. Not financial or legal advice.</span></div>

      {summaryError && <div className="inline-notice"><span>{summaryError}</span></div>}

      <section className="workspace-panel">
        <div className="section-header"><div><h2>Deductions tagged in FinTrack</h2><p>Sum of transactions tagged with a tax section for the selected financial year.</p></div><PieIcon size={20} /></div>
        <div className="tax-year-row">
          <label><span>Financial year</span><select value={year ?? ""} onChange={(event) => setYear(Number(event.target.value))}>{yearOptions.map((option) => <option key={option} value={option}>FY {option}-{String(option + 1).slice(-2)}</option>)}</select></label>
          {summary && <div className="tax-year-totals"><span>Total tagged: <strong>{currency.format(summary.totalClaimed)}</strong></span><span>Allowed after caps: <strong>{currency.format(summary.totalAllowed)}</strong></span></div>}
        </div>
        <div className="tax-summary-grid">
          {(summary?.summary ?? []).filter((entry) => entry.transactionCount > 0 || entry.claimed > 0).map((entry) => (
            <article key={entry.code} className="tax-summary-card">
              <div><strong>{entry.code}</strong><span>{entry.label}</span></div>
              <div className="tax-summary-numbers">
                <span>Tagged: <b>{currency.format(entry.claimed)}</b></span>
                <span>Allowed: <b>{currency.format(entry.allowed)}</b></span>
                {entry.limitInr !== null && <span>Cap: {formatCurrencyInr(entry.limitInr)}</span>}
              </div>
              {entry.utilizationPct !== null && <div className="tax-utilization"><span style={{ width: `${Math.min(100, entry.utilizationPct)}%` }} /></div>}
            </article>
          ))}
          {summary && summary.summary.every((entry) => entry.transactionCount === 0) && (
            <div className="empty-ledger"><ReceiptText size={20} /><strong>No tagged transactions yet</strong><span>Edit a transaction and set its Tax section to include it here.</span></div>
          )}
        </div>
      </section>

      <section className="workspace-panel">
        <div className="section-header"><div><h2>Income tax estimator</h2><p>Compare new vs old regime for the selected FY. Uses your tagged deductions as a starting point.</p></div><Calculator size={20} /></div>
        <div className="tax-estimator-grid">
          <div className="tax-estimator-form">
            <div className="tax-regime-toggle">
              <label><input type="radio" name="regime" value="new" checked={regime === "new"} onChange={() => setRegime("new")} />New regime</label>
              <label><input type="radio" name="regime" value="old" checked={regime === "old"} onChange={() => setRegime("old")} />Old regime</label>
            </div>
            <label className="tax-input"><span>Annual gross income (₹)</span><input inputMode="numeric" value={grossIncome} onChange={(event) => setGrossIncome(event.target.value)} placeholder="e.g. 1200000" /></label>
            {regime === "old" && (
              <>
                <label className="tax-input"><span>HRA exemption (₹)</span><input inputMode="numeric" value={hraExemption} onChange={(event) => setHraExemption(event.target.value)} placeholder="0" /></label>
                <label className="tax-input"><span>Professional tax (₹)</span><input inputMode="numeric" value={professionalTax} onChange={(event) => setProfessionalTax(event.target.value)} placeholder="0" /></label>
                <div className="tax-deduction-header"><strong>Chapter VI-A deductions</strong><button type="button" className="text-button" onClick={fillFromLedger} title="Copy allowed deductions from the summary above."><RotateCcw size={12} /> Autofill from ledger</button></div>
                <div className="tax-deduction-grid">
                  {DEDUCTION_INPUTS.map((entry) => (
                    <label key={entry.key} className="tax-input" title={entry.hint}>
                      <span>{entry.label}</span>
                      <input inputMode="numeric" value={deductions[entry.key] ?? ""} placeholder="0" onChange={(event) => setDeductions((current) => ({ ...current, [entry.key]: event.target.value }))} />
                    </label>
                  ))}
                </div>
              </>
            )}
            {regime === "new" && <p className="tax-note"><Sparkles size={13} /> The new regime uses only the ₹75,000 standard deduction. Chapter VI-A inputs are ignored.</p>}
            <button type="button" className="primary-button" onClick={() => void runEstimate()} disabled={estimating || !grossIncome}><Save size={14} /> {estimating ? "Calculating..." : "Estimate tax"}</button>
            {estimateError && <div className="inline-notice"><span>{estimateError}</span></div>}
          </div>
          <div className="tax-estimator-result">
            {estimate ? (
              <>
                <div className="tax-headline"><span>{estimate.financialYear} · {estimate.regime === "new" ? "New regime" : "Old regime"}</span><strong>{formatCurrencyInr(estimate.totalLiability)}</strong><small>Total liability (income tax + surcharge + 4% cess)</small></div>
                <ul className="tax-headline-breakdown">
                  <li><span>Gross income</span><b>{formatCurrencyInr(estimate.grossIncome)}</b></li>
                  <li><span>Standard deduction</span><b>−{formatCurrencyInr(estimate.standardDeduction)}</b></li>
                  <li><span>Other deductions (allowed)</span><b>−{formatCurrencyInr(estimate.totalDeductions - estimate.standardDeduction)}</b></li>
                  <li><span>Taxable income</span><b>{formatCurrencyInr(estimate.taxableIncome)}</b></li>
                  <li><span>Slab tax</span><b>{formatCurrencyInr(estimate.incomeTax)}</b></li>
                  <li><span>Rebate u/s 87A</span><b>−{formatCurrencyInr(estimate.rebate87A)}</b></li>
                  <li><span>Surcharge</span><b>{formatCurrencyInr(estimate.surcharge)}</b></li>
                  <li><span>Health & Education cess</span><b>{formatCurrencyInr(estimate.cess)}</b></li>
                  <li><span>Effective rate</span><b>{estimate.effectiveRatePct.toFixed(2)}%</b></li>
                </ul>
                <div className="tax-slabs">
                  <div className="tax-section-title"><strong>Slab break-up</strong><span>{estimate.slabResults.filter((slab) => slab.taxableInSlab > 0).length} slabs used</span></div>
                  <table>
                    <thead><tr><th>Slab</th><th>Rate</th><th>Taxable</th><th>Tax</th></tr></thead>
                    <tbody>
                      {estimate.slabResults.map((slab, index) => (
                        <tr key={index}>
                          <td>{formatCurrencyInr(slab.from)}{slab.to === null ? "+" : ` – ${formatCurrencyInr(slab.to)}`}</td>
                          <td>{Math.round(slab.rate * 100)}%</td>
                          <td>{formatCurrencyInr(slab.taxableInSlab)}</td>
                          <td>{formatCurrencyInr(slab.taxInSlab)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {estimate.notes.length > 0 && <ul className="tax-notes">{estimate.notes.map((note) => <li key={note}><Info size={12} /> {note}</li>)}</ul>}
              </>
            ) : (
              <div className="empty-ledger"><Landmark size={22} /><strong>Enter your gross income</strong><span>Run the estimator to see the slab break-up.</span></div>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
