import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "notifications:update");
    const result = await getDb().notification.updateMany({
      where: { userId: context.actorId, householdId: context.householdId, readAt: null },
      data: { readAt: new Date() },
    });
    return Response.json({ updated: result.count });
  } catch (error) {
    return apiError(error);
  }
}