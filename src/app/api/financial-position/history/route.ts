import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { captureNetWorthSnapshot } from "@/lib/connected-finance";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

const querySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), limit: z.coerce.number().int().min(1).max(365).default(180) });

export async function GET(request: Request) {
  try {
    const { householdId } = await requireHouseholdContext();
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const snapshots = await getDb().netWorthSnapshot.findMany({
      where: { householdId, recordedAt: { gte: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined, lte: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined } },
      orderBy: { recordedAt: "asc" }, take: query.limit,
    });
    return Response.json({ data: snapshots.map((item) => ({ date: item.recordedAt.toISOString(), assets: item.totalAssets.toNumber(), liabilities: item.totalLiabilities.toNumber(), netWorth: item.netWorth.toNumber() })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { actorId, householdId } = await requireHouseholdContext("write");
    await protectMutation(request, actorId, "financial-position:snapshot", { limit: 10, windowSeconds: 3600 });
    const snapshot = await getDb().$transaction(async (db) => {
      const created = await captureNetWorthSnapshot(db, householdId);
      await db.auditLog.create({ data: { householdId, actorId, action: "CREATE", entityType: "NetWorthSnapshot", entityId: created.id } });
      return created;
    });
    return Response.json({ data: { id: snapshot.id, date: snapshot.recordedAt.toISOString(), netWorth: snapshot.netWorth.toNumber() } }, { status: 201 });
  } catch (error) { return apiError(error); }
}