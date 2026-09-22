import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { detectRecurringPatterns } from "@/lib/connected-finance";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

export async function GET() {
  try { const { householdId } = await requireHouseholdContext(); const data = await getDb().recurringPattern.findMany({ where: { householdId }, orderBy: { lastDetectedAt: "desc" } }); return Response.json({ data: data.map((item) => ({ ...item, averageAmount: item.averageAmount.toNumber(), confidence: item.confidence.toNumber(), frequency: item.frequency.toLowerCase(), status: item.status.toLowerCase() })) }); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try { const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "recurring:detect", { limit: 5, windowSeconds: 3600 }); const patterns = await getDb().$transaction(async (db) => { const found = await detectRecurringPatterns(db, householdId); await db.auditLog.create({ data: { householdId, actorId, action: "CREATE", entityType: "RecurringDetection", entityId: "batch", metadata: { detected: found.length } } }); return found; }); return Response.json({ data: patterns.map((item) => ({ id: item.id, merchant: item.merchant, category: item.category, frequency: item.frequency.toLowerCase(), averageAmount: item.averageAmount.toNumber(), confidence: item.confidence.toNumber() })) }); } catch (error) { return apiError(error); }
}