"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, Check, CreditCard, Landmark, Pencil, Plus, ReceiptText, Send, Sparkles, Trash2, WalletCards, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AnalysisChartSpec } from "@/lib/analysis-schema";
import { useCurrencyFormatter } from "@/components/currency-context";
import { calculateDebtProjection } from "@/lib/debt-projection";

type Account = { id: string; name: string; institution: string | null; type: string; balance: number };
type LiabilityPayment = { id: string; amount: number; principal: number; interest: number; paidAt: string };
type Liability = { id: string; name: string; institution: string | null; type: string; balance: number; interestRate: number | null; minimumPayment: number | null; dueDay: number | null; payoff?: { months: number | null; totalInterest: number | null; projectedPayoffDate: string | null } | null; payments?: LiabilityPayment[] };
type HistoryPoint={date:string;assets:number;liabilities:number;netWorth:number};
type Recurring = { id: string; name: string; category: string; amount: number; frequency: string; nextDueDate: string; active: boolean };
type FinancialPosition = {
  accounts: Account[];
  liabilities: Liability[];
  recurring: Recurring[];
  summary: { totalAssets: number; totalLiabilities: number; netWorth: number; monthlyRecurring: number };
};

type PositionKind = "account" | "liability" | "recurring";

const chartColors = { ink: "#29313d", blue: "#2f6fec", gold: "#e4a11b", green: "#1f9d8a", coral: "#d4557a" } as const;

async function responseMessage(response: Response, fallback: string) {
  try {
    const result = await response.json() as { error?: string; issues?: Record<string, string[]> };
    return Object.values(result.issues ?? {}).flat().find(Boolean) ?? result.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function FinancialPositionWorkspace({ view = "position" }: { view?: "position" | "emi" }) {
  const { currency, currencySymbol } = useCurrencyFormatter();
  const [position, setPosition] = useState<FinancialPosition | null>(null);
  const [kind, setKind] = useState<PositionKind>("account");
  const [editing, setEditing] = useState<{ kind: PositionKind; id: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [selectedEmiId, setSelectedEmiId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function load() {
    try {
      const [response, historyResponse] = await Promise.all([
        fetch("/api/financial-position", { cache: "no-store" }),
        fetch("/api/financial-position/history", { cache: "no-store" }),
      ]);
      if (response.status === 401 || historyResponse.status === 401) {
        window.location.replace("/sign-in");
        return false;
      }
      if (!response.ok) throw new Error(await responseMessage(response, "Financial position could not be loaded."));
      if (!historyResponse.ok) throw new Error(await responseMessage(historyResponse, "Net-worth history could not be loaded."));
      const [result, historyResult] = await Promise.all([
        response.json() as Promise<{ data: FinancialPosition }>,
        historyResponse.json() as Promise<{ data: HistoryPoint[] }>,
      ]);
      setPosition(result.data);
      setHistory(historyResult.data);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Financial position could not be loaded.");
      return false;
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/financial-position", { cache: "no-store" }),fetch("/api/financial-position/history",{cache:"no-store"})])
      .then(async ([response,historyResponse]) => {
        if (response.status === 401 || historyResponse.status === 401) {
          window.location.replace("/sign-in");
          return null;
        }
        if (!response.ok) throw new Error(await responseMessage(response, "Financial position could not be loaded."));
        if (!historyResponse.ok) throw new Error(await responseMessage(historyResponse, "Net-worth history could not be loaded."));
        return {position:await response.json() as {data:FinancialPosition},history:await historyResponse.json() as {data:HistoryPoint[]}};
      })
      .then((result) => { if (active && result){setPosition(result.position.data);setHistory(result.history.data)} })
      .catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  function beginEdit(nextKind: PositionKind, item: Account | Liability | Recurring) {
    setKind(nextKind);
    setEditing({ kind: nextKind, id: item.id });
    window.setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const set = (name: string, value: string | number | null | boolean) => {
        const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (!control) return;
        if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(value);
        else control.value = value == null ? "" : String(value);
      };
      set("name", item.name);
      if (nextKind === "account") {
        const account = item as Account;
        set("institution", account.institution);
        set("type", account.type);
        set("balance", account.balance);
      } else if (nextKind === "liability") {
        const liability = item as Liability;
        set("institution", liability.institution);
        set("type", liability.type);
        set("balance", liability.balance);
        set("interestRate", liability.interestRate);
        set("minimumPayment", liability.minimumPayment);
        set("dueDay", liability.dueDay);
      } else {
        const recurring = item as Recurring;
        set("category", recurring.category);
        set("amount", recurring.amount);
        set("frequency", recurring.frequency);
        set("nextDueDate", recurring.nextDueDate);
        set("active", recurring.active);
      }
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const data = kind === "account" ? {
      name: form.get("name"), institution: form.get("institution") || null, type: form.get("type"), balance: form.get("balance"),
    } : kind === "liability" ? {
      name: form.get("name"), institution: form.get("institution") || null, type: form.get("type"), balance: form.get("balance"),
      interestRate: form.get("interestRate") || null, minimumPayment: form.get("minimumPayment") || null, dueDay: form.get("dueDay") || null,
    } : {
      name: form.get("name"), category: form.get("category"), amount: form.get("amount"), frequency: form.get("frequency"),
      nextDueDate: form.get("nextDueDate"), active: form.get("active") === "on",
    };
    const response = await fetch(editing ? `/api/financial-position/${editing.kind}/${editing.id}` : "/api/financial-position", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? data : { kind, data }),
    });
    if (!response.ok) return setNotice(await responseMessage(response, "Financial record could not be saved."));
    formElement.reset();
    setEditing(null);
    if (await load()) setNotice("Financial position updated.");
  }

  async function remove(kindToDelete: PositionKind, id: string) {
    const response = await fetch(`/api/financial-position/${kindToDelete}/${id}`, { method: "DELETE" });
    if (!response.ok) return setNotice(await responseMessage(response, "Financial record could not be deleted."));
    await load();
  }

  async function recordPayment(event:FormEvent<HTMLFormElement>){event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);const id=String(form.get("liabilityId"));const response=await fetch(`/api/liabilities/${id}/payments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:form.get("amount"),paidAt:form.get("paidAt")})});if(!response.ok)return setNotice(await responseMessage(response,"EMI payment could not be recorded."));formElement.reset();if(await load())setNotice("EMI payment recorded.")}

  if (view === "emi") {
    return <section className="position-workspace">{notice && <div className="inline-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}<EmiWorkspace liabilities={position?.liabilities ?? []} selectedId={selectedEmiId} onSelect={setSelectedEmiId} onRecordPayment={recordPayment} currency={currency} currencySymbol={currencySymbol} /></section>;
  }

  return <section className="position-workspace">
    {notice && <div className="inline-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
    <div className="position-summary">
      <article><span>Total assets</span><strong>{currency.format(position?.summary.totalAssets ?? 0)}</strong><WalletCards size={19} /></article>
      <article><span>Liabilities</span><strong>{currency.format(position?.summary.totalLiabilities ?? 0)}</strong><CreditCard size={19} /></article>
      <article><span>Net worth</span><strong>{currency.format(position?.summary.netWorth ?? 0)}</strong><Landmark size={19} /></article>
      <article><span>Monthly obligations</span><strong>{currency.format(position?.summary.monthlyRecurring ?? 0)}</strong><ReceiptText size={19} /></article>
    </div>
    <section className="workspace-panel net-worth-history"><div className="section-header"><div><h2>Net-worth history</h2><p>One closing position per day, updated when balances, liabilities, or linked transactions change.</p></div></div><div className="position-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history.map(item=>({...item,date:new Date(item.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}))} margin={{top:8,right:16,left:8,bottom:4}}><CartesianGrid vertical={false} stroke="#dce2ea"/><XAxis dataKey="date" axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Area dataKey="netWorth" stroke="#2f6fec" fill="#2f6fec" fillOpacity={.15}/></AreaChart></ResponsiveContainer></div></section>
    <form className="position-form" ref={formRef} onSubmit={save}>
      <div className="position-form-head"><div className="type-toggle position-tabs">{(["account", "liability", "recurring"] as PositionKind[]).map((item) => <button className={kind === item ? "active" : ""} type="button" key={item} onClick={() => { setKind(item); setEditing(null); formRef.current?.reset(); }}>{item === "account" ? "Assets" : item === "liability" ? "Debts & loans" : "Recurring bills"}</button>)}</div>{editing && <button className="text-button" type="button" onClick={() => { setEditing(null); formRef.current?.reset(); }}><X size={14} /> Cancel edit</button>}</div>
      <div className="position-fields">
        <label><span>Name</span><input name="name" placeholder={kind === "account" ? "Main checking" : kind === "liability" ? "Credit card" : "Monthly rent"} required /></label>
        {kind !== "recurring" && <label><span>Institution</span><input name="institution" placeholder="Optional" /></label>}
        {kind === "account" && <><label><span>Type</span><select name="type"><option value="checking">Checking</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="investment">Investment</option></select></label><MoneyInput name="balance" label="Balance" symbol={currencySymbol} /></>}
        {kind === "liability" && <><label><span>Type</span><select name="type"><option value="credit_card">Credit card</option><option value="loan">Loan / EMI</option><option value="mortgage">Mortgage / home loan</option><option value="other">Other</option></select></label><MoneyInput name="balance" label="Remaining balance" symbol={currencySymbol} /><label><span>Annual interest %</span><input name="interestRate" type="number" min="0" max="100" step="0.01" /></label><MoneyInput name="minimumPayment" label="Monthly payment / EMI" symbol={currencySymbol} required={false} /><label><span>Payment due day</span><input name="dueDay" type="number" min="1" max="31" /></label></>}
        {kind === "recurring" && <><label><span>Category</span><input name="category" placeholder="Housing" required /></label><MoneyInput name="amount" label="Amount" symbol={currencySymbol} /><label><span>Frequency</span><select name="frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label><label><span>Next due</span><input name="nextDueDate" type="date" required /></label><label className="active-check"><span>Active</span><input name="active" type="checkbox" defaultChecked /></label></>}
        <button className="primary-button" type="submit">{editing ? <Pencil size={16} /> : <Plus size={16} />}{editing ? "Save changes" : "Add record"}</button>
      </div>
    </form>
    <div className="position-lists">
      <PositionList title="Accounts" empty="No balances tracked" items={position?.accounts ?? []} kind="account" onEdit={beginEdit} onDelete={remove} detail={(item) => `${item.type.replace("_", " ")} · ${currency.format(item.balance)}`} />
      <PositionList title="Liabilities" empty="No liabilities tracked" items={position?.liabilities ?? []} kind="liability" onEdit={beginEdit} onDelete={remove} detail={(item) => `${item.type.replace("_", " ")} · ${currency.format(item.balance)} remaining${item.minimumPayment ? ` · ${currency.format(item.minimumPayment)} EMI` : ""}`} />
      <PositionList title="Recurring obligations" empty="No recurring obligations tracked" items={position?.recurring ?? []} kind="recurring" onEdit={beginEdit} onDelete={remove} detail={(item) => `${currency.format(item.amount)} ${item.frequency} · due ${new Date(`${item.nextDueDate}T12:00:00`).toLocaleDateString()}`} />
    </div>
  </section>;
}

function MoneyInput({ name, label, symbol, required = true }: { name: string; label: string; symbol: string; required?: boolean }) {
  return <label><span>{label}</span><div className="compact-money"><b>{symbol}</b><input name={name} type="number" min="0" step="0.01" required={required} /></div></label>;
}

function EmiWorkspace({ liabilities, selectedId, onSelect, onRecordPayment, currency, currencySymbol }: { liabilities: Liability[]; selectedId: string; onSelect: (id: string) => void; onRecordPayment: (event: FormEvent<HTMLFormElement>) => void; currency: Intl.NumberFormat; currencySymbol: string }) {
  const emiLiabilities = liabilities.filter((item) => (item.type === "loan" || item.type === "mortgage") && (item.minimumPayment ?? 0) > 0);
  const selected = emiLiabilities.find((item) => item.id === selectedId) ?? emiLiabilities[0] ?? null;

  if (!selected) {
    return <section className="workspace-panel emi-workspace"><div className="section-header"><div><h2>EMI planner</h2><p>Track installments, tenure, and repayment progress</p></div></div><div className="emi-empty"><span><Landmark size={21} /></span><strong>No EMI plan yet</strong><p>Add a loan or mortgage with its interest rate, monthly payment, and due day.</p></div></section>;
  }

  const monthlyEmi = selected.minimumPayment ?? 0;
  const projection = calculateDebtProjection(selected.balance, selected.interestRate ?? 0, monthlyEmi, selected.dueDay ?? 1);
  const payoffLabel = projection.months === null ? "EMI too low" : projection.months === 0 ? "Paid off" : `${projection.months} months`;
  const nextPayment = projection.schedule[0]?.payment ?? monthlyEmi;

  return <section className="workspace-panel emi-workspace">
    <div className="section-header emi-heading"><div><h2>EMI planner</h2><p>Projected from the current balance and annual interest rate</p></div><label><span>Loan</span><select value={selected.id} onChange={(event) => onSelect(event.target.value)}>{emiLiabilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="emi-summary">
      <article><span>Remaining balance</span><strong>{currency.format(selected.balance)}</strong></article>
      <article><span>Monthly EMI</span><strong>{currency.format(monthlyEmi)}</strong></article>
      <article><span>Interest rate</span><strong>{selected.interestRate ?? 0}% <small>p.a.</small></strong></article>
      <article><span>Remaining tenure</span><strong>{payoffLabel}</strong>{projection.projectedPayoffDate && <small>Until {projection.projectedPayoffDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</small>}</article>
    </div>
    {projection.months === null && <div className="emi-warning">The monthly EMI must be greater than the monthly interest to reduce this balance.</div>}
    <div className="emi-grid">
      <section className="emi-schedule"><div className="emi-section-title"><strong>Upcoming schedule</strong><span>Next {projection.schedule.length} installments</span></div>{projection.schedule.length ? <div className="emi-table-wrap"><table><thead><tr><th>Due</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>{projection.schedule.map((item) => <tr key={item.installment}><td>{item.dueDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td><td>{currency.format(item.payment)}</td><td>{currency.format(item.principal)}</td><td>{currency.format(item.interest)}</td><td>{currency.format(item.closingBalance)}</td></tr>)}</tbody></table></div> : <div className="emi-section-empty">No upcoming installments.</div>}</section>
      <section className="emi-payments"><div className="emi-section-title"><strong>Record payment</strong><span>Updates balance and history</span></div>{selected.balance > 0 ? <form key={selected.id} onSubmit={onRecordPayment}><input name="liabilityId" type="hidden" value={selected.id} /><label><span>Amount</span><div className="compact-money"><b>{currencySymbol}</b><input name="amount" type="number" min="0.01" step="0.01" defaultValue={nextPayment.toFixed(2)} required /></div></label><label><span>Paid on</span><input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><button className="primary-button">Record EMI payment</button></form> : <div className="emi-paid-off"><Check size={16} /> This loan is paid off.</div>}<div className="emi-history"><div className="emi-section-title"><strong>Recent payments</strong><span>{selected.payments?.length ?? 0} recorded</span></div>{selected.payments?.length ? selected.payments.slice(0, 5).map((payment) => <div key={payment.id}><span>{new Date(payment.paidAt).toLocaleDateString()}</span><strong>{currency.format(payment.amount)}</strong><small>{currency.format(payment.principal)} principal · {currency.format(payment.interest)} interest</small></div>) : <div className="emi-section-empty">No EMI payments recorded yet.</div>}</div></section>
    </div>
  </section>;
}

function PositionList<T extends { id: string; name: string }>({ title, empty, items, kind, detail, onEdit, onDelete }: { title: string; empty: string; items: T[]; kind: PositionKind; detail: (item: T) => string; onEdit: (kind: PositionKind, item: T) => void; onDelete: (kind: PositionKind, id: string) => void }) {
  return <section className="workspace-panel position-list"><div className="section-header"><div><h2>{title}</h2><p>{items.length} tracked</p></div></div>{items.length ? items.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>{detail(item)}</span></div><button className="icon-button" onClick={() => onEdit(kind, item)} aria-label={`Edit ${item.name}`}><Pencil size={15} /></button><button className="delete-transaction" onClick={() => onDelete(kind, item.id)} aria-label={`Delete ${item.name}`}><Trash2 size={15} /></button></article>) : <div className="position-empty">{empty}</div>}</section>;
}

export function EphemeralAnalyst({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("Ask about spending, balances, liabilities, recurring commitments, or request a chart.");
  const [chart, setChart] = useState<AnalysisChartSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState("auto");
  const [preferredChart, setPreferredChart] = useState("auto");
  const controllerRef = useRef<AbortController | null>(null);

  function clearAnalysis() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setQuestion("");
    setAnswer("Ask about spending, balances, liabilities, recurring commitments, or request a chart.");
    setChart(null);
    setHistory([]);
    setLoading(false);
  }

  useEffect(() => {
    function clearOnPageHide() { clearAnalysis(); }
    function clearOnPageShow(event: PageTransitionEvent) { if (event.persisted) clearAnalysis(); }
    window.addEventListener("pagehide", clearOnPageHide);
    window.addEventListener("pageshow", clearOnPageShow);
    return () => {
      controllerRef.current?.abort();
      window.removeEventListener("pagehide", clearOnPageHide);
      window.removeEventListener("pageshow", clearOnPageShow);
    };
  }, []);

  async function ask(event?: FormEvent<HTMLFormElement>, suggestedQuestion?: string) {
    event?.preventDefault();
    const basePrompt = suggestedQuestion ?? question;
    const controls = [from ? `from ${from}` : "", to ? `to ${to}` : "", groupBy !== "auto" ? `group by ${groupBy}` : "", preferredChart !== "auto" ? `use a ${preferredChart} chart` : ""].filter(Boolean).join(", ");
    const prompt = controls ? `${basePrompt}. Apply these controls: ${controls}.` : basePrompt;
    if (!prompt.trim() || loading) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setChart(null);
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, history: history.slice(-12) }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The analyst could not complete this request."));
      const result = await response.json() as { data: { answer: string; chart: AnalysisChartSpec | null } };
      setAnswer(result.data.answer);
      setChart(result.data.chart);
      setHistory((current) => [...current, { role: "user" as const, content: prompt }, { role: "assistant" as const, content: result.data.answer }].slice(-12));
      setQuestion("");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setAnswer((error as Error).message);
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }

  if (!open) return null;
  const suggestions = ["Chart my monthly spending for the last six months", "Summarize my balances and liabilities", "What recurring obligations are due next?"];
  // The disclosure uses a literal possessive apostrophe in visible copy.
  // eslint-disable-next-line react/no-unescaped-entities
  return <div className="agent-panel analyst-canvas" role="dialog" aria-label="FinTrack Nemotron financial analyst"><div className="agent-header"><div className="agent-avatar"><Bot size={20} /></div><div><strong>FinTrack Analyst</strong><span><i /> Nemotron via OpenRouter · ephemeral result</span></div><button className="icon-button" onClick={() => { clearAnalysis(); onClose(); }} aria-label="Close and clear analyst"><X size={20} /></button></div><div className="agent-body"><div className="analysis-controls"><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Analysis start date" /><input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Analysis end date" /><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} aria-label="Analysis grouping"><option value="auto">Auto grouping</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="category">By category</option><option value="merchant">By merchant</option></select><select value={preferredChart} onChange={(event) => setPreferredChart(event.target.value)} aria-label="Preferred chart"><option value="auto">Auto chart</option><option value="bar">Bar</option><option value="line">Line</option><option value="area">Area</option><option value="pie">Pie</option></select></div>{history.length>1&&<div className="analysis-history">{history.slice(-4).map((message,index)=><p className={message.role} key={`${message.role}-${index}`}><strong>{message.role==="user"?"You":"FinTrack"}</strong>{message.content}</p>)}</div>}<div className="agent-intro"><Sparkles size={16} /><p>{loading ? "Analyzing your household records..." : answer}</p></div>{chart && <SafeChart key={`${chart.title}-${chart.data.length}`} spec={chart} />}<span className="suggestion-label">Try asking</span><div className="question-list">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(undefined, suggestion)} disabled={loading}>{suggestion}<Send size={14} /></button>)}</div><div className="ephemeral-note"><Check size={14} /><span>FinTrack does not save this result. Relevant financial data is sent through OpenRouter to the selected model and is subject to those providers' data-retention settings.</span></div></div><form className="agent-input" onSubmit={(event) => void ask(event)}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a follow-up about your finances..." aria-label="Ask the financial analyst" maxLength={600} /><button type="submit" aria-label="Send question" disabled={loading}><Send size={17} /></button></form></div>;
}

function SafeChart({ spec }: { spec: AnalysisChartSpec }) {
  const [displayType, setDisplayType] = useState(spec.type);
  const first = spec.series[0];
  const second = spec.series[1];
  const color = chartColors[first.colorToken];
  const secondColor = second ? chartColors[second.colorToken] : undefined;
  const chartCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: spec.currency ?? "USD", maximumFractionDigits: 0 });
  const tooltipFormatter = (value: unknown) => {
    const normalized = Array.isArray(value) ? value[0] : value;
    return first.format === "currency" ? chartCurrency.format(Number(normalized ?? 0)) : String(normalized ?? 0);
  };
  const axes = <><CartesianGrid vertical={false} stroke="#dce2ea" /><XAxis dataKey="x" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} /><Tooltip formatter={tooltipFormatter} /></>;
  function exportCsv(){const headers=["Label",...spec.series.map(item=>item.label)];const rows=spec.data.map(point=>[point.x,point.primary,point.secondary??""]);const csv=[headers,...rows].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const link=document.createElement("a");link.href=url;link.download=`${spec.title.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.csv`;link.click();URL.revokeObjectURL(url)}
  const availableTypes=spec.xKind==="date"?["bar","line","area"]:["bar",...(spec.series.length===1?["pie"]:[])];
  return <section className="generated-chart"><div className="generated-chart-head"><strong>{spec.title}</strong><div><select value={displayType} onChange={(event)=>setDisplayType(event.target.value as typeof displayType)}>{availableTypes.map(type=><option key={type}>{type}</option>)}</select><button onClick={exportCsv}>Export CSV</button></div></div><div><ResponsiveContainer width="100%" height="100%">{displayType === "pie" ? <PieChart><Pie data={spec.data.slice(0,8)} dataKey="primary" nameKey="x" innerRadius={42} outerRadius={68} paddingAngle={2}>{spec.data.slice(0,8).map((point, index) => <Cell key={point.x} fill={Object.values(chartColors)[index % Object.values(chartColors).length]} />)}</Pie><Tooltip formatter={tooltipFormatter} /></PieChart> : displayType === "line" ? <LineChart data={spec.data}>{axes}<Line type="monotone" dataKey="primary" name={first.label} stroke={color} strokeWidth={2.5} dot={false} />{second && <Line type="monotone" dataKey="secondary" name={second.label} stroke={secondColor} strokeWidth={2.5} dot={false} />}</LineChart> : displayType === "area" ? <AreaChart data={spec.data}>{axes}<Area type="monotone" dataKey="primary" name={first.label} stroke={color} fill={color} fillOpacity={0.16} />{second && <Area type="monotone" dataKey="secondary" name={second.label} stroke={secondColor} fill={secondColor} fillOpacity={0.1} />}</AreaChart> : <BarChart data={spec.data}>{axes}<Bar dataKey="primary" name={first.label} fill={color} radius={[4,4,0,0]} />{second && <Bar dataKey="secondary" name={second.label} fill={secondColor} radius={[4,4,0,0]} />}</BarChart>}</ResponsiveContainer></div></section>;
}
