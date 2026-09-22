import { z } from "zod";

export const analysisRequestSchema = z.object({
  question: z.string().trim().min(3).max(600),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1200) }).strict()).max(12).default([]),
});

const chartPointSchema = z.object({
  x: z.string().trim().min(1).max(80),
  primary: z.number().finite(),
  secondary: z.number().finite().optional(),
}).strict();

export const chartSpecSchema = z.object({
  version: z.literal(1),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  type: z.enum(["bar", "line", "area", "pie"]),
  title: z.string().trim().min(1).max(100),
  xKind: z.enum(["category", "date"]),
  series: z.array(z.object({
    key: z.enum(["primary", "secondary"]),
    label: z.string().trim().min(1).max(60),
    format: z.enum(["currency", "number", "percent"]),
    colorToken: z.enum(["ink", "blue", "gold", "green", "coral"]),
  }).strict()).min(1).max(2),
  data: z.array(chartPointSchema).min(1).max(60),
}).strict().superRefine((chart, context) => {
  if (chart.type === "pie" && (chart.data.length > 8 || chart.series.length !== 1 || chart.data.some((point) => point.primary < 0))) {
    context.addIssue({ code: "custom", message: "Pie charts require one non-negative series and no more than eight points." });
  }
  if (["line", "area"].includes(chart.type) && chart.xKind !== "date") {
    context.addIssue({ code: "custom", message: "Line and area charts require a date axis." });
  }
});

export type AnalysisChartSpec = z.infer<typeof chartSpecSchema>;