"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useCurrencyFormatter } from "@/components/currency-context";

type WeeklyInsight = {
  facts: {
    currency: string;
    window: string;
    currentExpense: number;
    previousExpense: number;
    spendChangePct: number | null;
    currentIncome: number;
    incomeChangePct: number | null;
    transactionCount: number;
    monthlyExpense: number;
    monthlyTransactionCount: number;
    avgDailyExpense: number;
    activeSubscriptions: number;
    largestExpense: { merchant: string; amount: number; category: string } | null;
    topCategories: Array<{ category: string; amount: number }>;
  };
  narrative: string;
};

export function WeeklyInsightCard() {
  const { currency } = useCurrencyFormatter();
  const [insight, setInsight] = useState<WeeklyInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analysis/weekly-insight", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to see insights." : "Weekly insight unavailable.");
      const result = await response.json() as { data: WeeklyInsight };
      setInsight(result.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Weekly insight unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/analysis/weekly-insight", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Weekly insight unavailable.");
        return response.json() as Promise<{ data: WeeklyInsight }>;
      })
      .then((result) => { if (active) setInsight(result.data); })
      .catch((loadError: Error) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const facts = insight?.facts;
  const spendChangePct = facts?.spendChangePct ?? null;

  return (
    <article className="insight-card">
      <div className="insight-card-header">
        <div><Sparkles size={16} /><strong>Weekly AI insight</strong></div>
        <button className="icon-button" onClick={() => void load()} disabled={loading} aria-label="Refresh weekly insight" title="Refresh"><RefreshCw size={14} /></button>
      </div>
      {loading && !insight && <div className="insight-card-loading"><LoaderCircle size={16} /> <span>Analyzing your week...</span></div>}
      {error && !insight && <p className="insight-card-error">{error}</p>}
      {insight && (
        <>
          <p className="insight-card-narrative">{insight.narrative}</p>
          <div className="insight-card-stats">
            <div>
              <span>This week</span>
              <strong>{currency.format(facts?.currentExpense ?? 0)}</strong>
              {spendChangePct !== null && (
                <small className={spendChangePct <= 0 ? "positive" : "negative"}>
                  {spendChangePct <= 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                  {Math.abs(spendChangePct)}% vs prior week
                </small>
              )}
            </div>
            <div>
              <span>Avg daily (30d)</span>
              <strong>{currency.format(facts?.avgDailyExpense ?? 0)}</strong>
              <small>{facts?.monthlyTransactionCount ?? 0} transactions</small>
            </div>
            <div>
              <span>Top category</span>
              <strong>{facts?.topCategories[0]?.category ?? "—"}</strong>
              <small>{currency.format(facts?.topCategories[0]?.amount ?? 0)}</small>
            </div>
          </div>
        </>
      )}
    </article>
  );
}
