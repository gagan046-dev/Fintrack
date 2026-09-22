import { ApiResponseError, apiError } from "@/lib/api-response";
import { analysisRequestSchema } from "@/lib/analysis-schema";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { prepareNemotronAnalysis } from "@/lib/nemotron-analysis";
import { protectMutation } from "@/lib/request-protection";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

function requestsPersonalizedAdvice(question: string) {
  const decisionLanguage = /\b(should|recommend|advise|best choice|what would you do|tell me (?:to|whether)|is it wise|can i afford)\b/i;
  const regulatedTopic = /\b(invest|stock|bond|crypto|security|portfolio|buy|sell|trade|loan|borrow|mortgage|credit|refinance|tax|legal|bankruptcy|insurance)\b/i;
  const directActionRequest = /\b(?:where|how|what)\s+(?:should\s+)?(?:i|we)\s+(?:invest|trade|buy|sell|borrow)\b/i;
  return directActionRequest.test(question) || decisionLanguage.test(question) && (regulatedTopic.test(question) || /\b(purchase|afford)\b/i.test(question));
}

function containsPersonalizedAdvice(answer: string) {
  return /\b(you should|i recommend|you need to|your best option|buy|sell|take out|apply for|refinance|invest in)\b/i.test(answer);
}

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "analysis:query", { limit: 20, windowSeconds: 60 });
    if (!process.env.OPENROUTER_API_KEY?.trim()) throw new ApiResponseError("OpenRouter is not configured. Add OPENROUTER_API_KEY to the server environment.", 503);
    const input = analysisRequestSchema.parse(await request.json());
    if (requestsPersonalizedAdvice(input.question)) {
      throw new ApiResponseError("FinTrack provides descriptive analysis, not personalized investment, credit, tax, legal, or purchasing advice.", 422);
    }
    const household = await getDb().household.findUniqueOrThrow({ where: { id: context.householdId }, select: { currency: true } });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          send("status", { phase: "planning", message: "Understanding your request" });
          const result = await prepareNemotronAnalysis({
            householdId: context.householdId,
            currency: household.currency,
            question: input.question,
            history: input.history,
            abortSignal: request.signal,
            onPhase: (phase) => send("status", { phase, message: phase === "chart" ? "Building your chart" : "Analyzing your records" }),
          });
          send("chart", { chart: result.chart });
          send("status", { phase: "responding", message: "Writing the analysis" });
          let answer = "";
          for await (const delta of result.textStream) {
            const candidate = answer + delta;
            if (containsPersonalizedAdvice(candidate)) throw new ApiResponseError("The analyst generated advice outside FinTrack's descriptive scope. Rephrase your question as a request for facts, trends, or comparisons.", 422);
            answer = candidate;
            send("delta", { text: delta });
          }
          send("done", { answer, chart: result.chart, metadata: { ephemeral: true, model: process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free" } });
        } catch (error) {
          const details = error instanceof Error ? { name: error.name } : { name: "UnknownError" };
          console.error("OpenRouter Nemotron analysis stream failed.", details);
          send("error", { message: error instanceof ApiResponseError ? error.message : "The analyst could not complete this request." });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    if (error instanceof ApiResponseError || error instanceof ZodError || error instanceof SyntaxError) return apiError(error);
    const details = error instanceof Error ? { name: error.name } : { name: "UnknownError" };
    console.error("OpenRouter Nemotron analysis request failed.", details);
    return Response.json({ error: "The analyst could not complete this request." }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}