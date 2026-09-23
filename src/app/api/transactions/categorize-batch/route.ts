import { z } from "zod";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { protectMutation } from "@/lib/request-protection";

const requestSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().min(1).max(200),
    merchant: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500),
  })).min(1).max(50),
});

const CATEGORIES = [
  "Food", "Dining", "Transport", "Utilities", "Subscriptions", "Housing",
  "Healthcare", "Education", "Entertainment", "Shopping", "Personal care",
  "Insurance", "Investments", "Taxes", "Salary", "Business", "Charity", "Travel",
];

const RULE_BASED: Array<[string, string[]]> = [
  ["Food", ["grocery", "market", "whole foods", "cafe", "starbucks", "dmart", "bigbasket", "blinkit", "zepto", "swiggy instamart"]],
  ["Dining", ["restaurant", "dinner", "pizza", "doordash", "swiggy", "zomato", "kfc", "mcdonald", "dominos", "haldiram"]],
  ["Transport", ["uber", "ola", "rapido", "lyft", "fuel", "petrol", "shell", "hpcl", "iocl", "metro", "irctc", "auto"]],
  ["Utilities", ["electric", "internet", "water", "energy", "airtel", "jio", "bsnl", "gas cylinder", "broadband"]],
  ["Subscriptions", ["spotify", "netflix", "prime video", "hotstar", "disney+", "youtube premium", "gaana", "apple music", "subscription", "renewal"]],
  ["Housing", ["rent", "mortgage", "landlord", "society maintenance", "housing"]],
  ["Healthcare", ["hospital", "doctor", "pharmacy", "medicine", "apollo", "medplus", "1mg", "netmeds"]],
  ["Education", ["school", "college", "tuition", "udemy", "coursera", "byju", "unacademy", "vedantu"]],
  ["Entertainment", ["movie", "bookmyshow", "pvr", "inox", "concert", "gaming", "steam"]],
  ["Investments", ["mutual fund", "sip", "zerodha", "groww", "kite", "upstox", "stock", "nps", "ppf", "fd"]],
  ["Insurance", ["insurance", "premium", "policybazaar", "lic", "star health"]],
  ["Salary", ["salary", "payroll", "credited by employer"]],
  ["Travel", ["flight", "makemytrip", "goibibo", "yatra", "ixigo", "hotel", "oyo", "airbnb"]],
];

function ruleBasedCategory(merchant: string, description: string) {
  const text = `${merchant} ${description}`.toLowerCase();
  return RULE_BASED.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ?? null;
}

const responseSchema = z.object({
  suggestions: z.array(z.object({
    id: z.string(),
    category: z.string(),
  })),
});

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function POST(request: Request) {
  try {
    const { actorId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "transactions:categorize-batch", { limit: 30, windowSeconds: 60 });
    const input = requestSchema.parse(await request.json());

    const results = new Map<string, { category: string; source: "rule" | "ai" | "fallback" }>();
    const unresolved: typeof input.transactions = [];
    for (const item of input.transactions) {
      const suggestion = ruleBasedCategory(item.merchant, item.description);
      if (suggestion) results.set(item.id, { category: suggestion, source: "rule" });
      else unresolved.push(item);
    }

    if (unresolved.length && process.env.OPENROUTER_API_KEY?.trim()) {
      try {
        const aiResult = await generateText({
          model: openrouter(process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free"),
          instructions: `Categorize each transaction into exactly one of: ${CATEGORIES.join(", ")}. Return strict JSON: {"suggestions":[{"id":"...","category":"..."}]}. Use "Uncategorized" if unclear. Never invent transactions, never provide advice.`,
          prompt: JSON.stringify({ transactions: unresolved }),
          maxOutputTokens: 400,
          maxRetries: 1,
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        });
        const parsed = responseSchema.parse(extractJson(aiResult.text));
        for (const item of parsed.suggestions) {
          const category = CATEGORIES.includes(item.category) ? item.category : "Uncategorized";
          if (unresolved.some((entry) => entry.id === item.id)) {
            results.set(item.id, { category, source: "ai" });
          }
        }
      } catch {
        // Fall through — remaining will be labeled fallback below.
      }
    }

    for (const item of unresolved) {
      if (!results.has(item.id)) results.set(item.id, { category: "Uncategorized", source: "fallback" });
    }

    return Response.json({
      data: {
        categories: CATEGORIES,
        suggestions: [...results.entries()].map(([id, value]) => ({ id, ...value })),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
