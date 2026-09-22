"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bot, Check, Download, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AnalysisChartSpec } from "@/lib/analysis-schema";

const chartColors = {
  ink: "#29313d",
  blue: "#2f6fec",
  gold: "#e4a11b",
  green: "#1f9d8a",
  coral: "#d4557a",
} as const;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AnalysisPhase = "idle" | "planning" | "analyzing" | "chart" | "responding";

async function responseMessage(response: Response, fallback: string) {
  try {
    const result = await response.json() as { error?: string };
    return result.error ?? fallback;
  } catch {
    return fallback;
  }
}

function parseEventBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

export function EphemeralAnalyst({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [chart, setChart] = useState<AnalysisChartSpec | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [chartLoading, setChartLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState("auto");
  const [preferredChart, setPreferredChart] = useState("auto");
  const controllerRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const loading = phase !== "idle";
  const hasConversation = history.some((message) => message.role === "user");

  function clearAnalysis() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setQuestion("");
    setChart(null);
    setHistory([]);
    setPhase("idle");
    setChartLoading(false);
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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, chart, chartLoading, phase]);

  async function ask(event?: FormEvent<HTMLFormElement>, suggestedQuestion?: string) {
    event?.preventDefault();
    const visibleQuestion = (suggestedQuestion ?? question).trim();
    if (!visibleQuestion || loading) return;

    const controls = [
      from ? `from ${from}` : "",
      to ? `to ${to}` : "",
      groupBy !== "auto" ? `group by ${groupBy}` : "",
      preferredChart !== "auto" ? `use a ${preferredChart} chart` : "",
    ].filter(Boolean).join(", ");
    const prompt = controls ? `${visibleQuestion}. Apply these controls: ${controls}.` : visibleQuestion;
    const priorHistory = history.filter((message) => message.content).map(({ role, content }) => ({ role, content })).slice(-12);
    const assistantId = crypto.randomUUID();
    const expectsChart = preferredChart !== "auto" || /\b(chart|graph|plot|trend)\b/i.test(visibleQuestion);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setQuestion("");
    setChart(null);
    setChartLoading(expectsChart);
    setPhase("planning");
    setHistory((current) => [...current, { id: crypto.randomUUID(), role: "user" as const, content: visibleQuestion }, { id: assistantId, role: "assistant" as const, content: "" }].slice(-12));

    const updateAssistant = (update: (content: string) => string) => {
      setHistory((current) => current.map((message) => message.id === assistantId ? { ...message, content: update(message.content) } : message));
    };

    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, history: priorHistory }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The analyst could not complete this request."));
      if (!response.body) throw new Error("The analyst stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          if (!block.trim()) continue;
          const parsed = parseEventBlock(block);
          const payload = JSON.parse(parsed.data) as {
            phase?: AnalysisPhase;
            message?: string;
            text?: string;
            chart?: AnalysisChartSpec | null;
            answer?: string;
          };
          if (parsed.event === "status" && payload.phase) {
            setPhase(payload.phase);
            if (payload.phase === "chart") setChartLoading(true);
            if (payload.phase === "responding") setChartLoading(false);
          }
          if (parsed.event === "chart") {
            setChart(payload.chart ?? null);
            setChartLoading(false);
          }
          if (parsed.event === "delta" && payload.text) updateAssistant((content) => content + payload.text);
          if (parsed.event === "done") {
            if (payload.answer) updateAssistant((content) => content || payload.answer || "");
            setChart(payload.chart ?? null);
            setChartLoading(false);
            setPhase("idle");
            finished = true;
          }
          if (parsed.event === "error") {
            updateAssistant(() => payload.message ?? "The analyst could not complete this request.");
            setChartLoading(false);
            setPhase("idle");
            finished = true;
          }
        }
        if (done) break;
      }
      if (!finished) setPhase("idle");
    } catch (error) {
      if ((error as Error).name !== "AbortError") updateAssistant(() => (error as Error).message);
      setChartLoading(false);
      setPhase("idle");
    }
  }

  if (!open) return null;
  const phaseLabels: Record<Exclude<AnalysisPhase, "idle">, string> = {
    planning: "Understanding your request",
    analyzing: "Analyzing your records",
    chart: "Building your chart",
    responding: "Writing the analysis",
  };
  const suggestions = [
    "Chart my monthly spending for the last six months",
    "Summarize my balances and liabilities",
    "What recurring obligations are due next?",
  ];

  return (
    <div className="agent-panel analyst-canvas" role="dialog" aria-label="FinTrack Nemotron financial analyst">
      <div className="agent-header">
        <div className="agent-avatar"><Bot size={20} /></div>
        <div><strong>FinTrack Analyst</strong><span><i /> Nemotron via OpenRouter · ephemeral result</span></div>
        <button className="icon-button" onClick={() => { clearAnalysis(); onClose(); }} aria-label="Close and clear analyst"><X size={20} /></button>
      </div>

      <div className="agent-body analyst-body">
        <div className="analysis-controls">
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Analysis start date" />
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Analysis end date" />
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} aria-label="Analysis grouping"><option value="auto">Auto grouping</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="category">By category</option><option value="merchant">By merchant</option></select>
          <select value={preferredChart} onChange={(event) => setPreferredChart(event.target.value)} aria-label="Preferred chart"><option value="auto">Auto chart</option><option value="bar">Bar</option><option value="line">Line</option><option value="area">Area</option><option value="pie">Pie</option></select>
        </div>

        <div className="analysis-thread" aria-live="polite">
          {!hasConversation && <div className="agent-intro"><Sparkles size={16} /><p>Ask about spending, balances, liabilities, recurring commitments, or request a chart.</p></div>}
          {history.map((message) => (
            <article className={`analysis-message ${message.role}`} key={message.id}>
              <strong>{message.role === "user" ? "You" : "FinTrack"}</strong>
              {message.content ? <p>{message.content}</p> : loading && message.role === "assistant" ? <div className="analysis-status"><LoaderCircle size={16} /><span>{phaseLabels[phase]}</span></div> : null}
            </article>
          ))}
          {chartLoading && <div className="chart-loading" role="status"><div className="chart-loading-bars"><i /><i /><i /><i /><i /></div><span>Generating and aligning chart data...</span></div>}
          {chart && <SafeChart key={`${chart.title}-${chart.data.length}`} spec={chart} />}
          <div ref={threadEndRef} />
        </div>

        {!hasConversation && !loading && <div className="analysis-suggestions"><span className="suggestion-label">Try asking</span><div className="question-list">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(undefined, suggestion)}>{suggestion}<Send size={14} /></button>)}</div></div>}
        <div className="ephemeral-note"><Check size={14} /><span>FinTrack does not save this result. Relevant financial data is sent through OpenRouter to the selected model and is subject to the applicable provider data-retention settings.</span></div>
      </div>

      <form className="agent-input" onSubmit={(event) => void ask(event)}>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={hasConversation ? "Ask a follow-up..." : "Ask about your financial position..."} aria-label="Ask the financial analyst" maxLength={600} />
        <button type="submit" aria-label="Send question" disabled={loading || !question.trim()}>{loading ? <LoaderCircle size={17} /> : <Send size={17} />}</button>
      </form>
    </div>
  );
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
  const axes = <><CartesianGrid vertical={false} stroke="#dce2ea" /><XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={62} tickFormatter={(value) => first.format === "currency" ? chartCurrency.format(Number(value)) : String(value)} /><Tooltip formatter={tooltipFormatter} /></>;

  function exportCsv() {
    const headers = ["Label", ...spec.series.map((item) => item.label)];
    const rows = spec.data.map((point) => [point.x, point.primary, point.secondary ?? ""]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const availableTypes: AnalysisChartSpec["type"][] = spec.xKind === "date" ? ["bar", "line", "area"] : ["bar", ...(spec.series.length === 1 ? ["pie" as const] : [])];

  return (
    <section className="generated-chart">
      <div className="generated-chart-head">
        <strong>{spec.title}</strong>
        <div><select value={displayType} onChange={(event) => setDisplayType(event.target.value as AnalysisChartSpec["type"])}>{availableTypes.map((type) => <option key={type}>{type}</option>)}</select><button onClick={exportCsv}><Download size={14} /> Export CSV</button></div>
      </div>
      <div className="generated-chart-viewport">
        <ResponsiveContainer width="100%" height="100%">
          {displayType === "pie" ? <PieChart><Pie data={spec.data.slice(0, 8)} dataKey="primary" nameKey="x" innerRadius="48%" outerRadius="76%" paddingAngle={2}>{spec.data.slice(0, 8).map((point, index) => <Cell key={point.x} fill={Object.values(chartColors)[index % Object.values(chartColors).length]} />)}</Pie><Tooltip formatter={tooltipFormatter} /></PieChart>
            : displayType === "line" ? <LineChart data={spec.data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>{axes}<Line type="monotone" dataKey="primary" name={first.label} stroke={color} strokeWidth={2.5} dot={false} />{second && <Line type="monotone" dataKey="secondary" name={second.label} stroke={secondColor} strokeWidth={2.5} dot={false} />}</LineChart>
              : displayType === "area" ? <AreaChart data={spec.data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>{axes}<Area type="monotone" dataKey="primary" name={first.label} stroke={color} fill={color} fillOpacity={0.16} />{second && <Area type="monotone" dataKey="secondary" name={second.label} stroke={secondColor} fill={secondColor} fillOpacity={0.1} />}</AreaChart>
                : <BarChart data={spec.data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>{axes}<Bar dataKey="primary" name={first.label} fill={color} radius={[4, 4, 0, 0]} />{second && <Bar dataKey="secondary" name={second.label} fill={secondColor} radius={[4, 4, 0, 0]} />}</BarChart>}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
