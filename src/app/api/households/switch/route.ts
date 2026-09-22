import { cookies } from "next/headers";
import { ApiResponseError, apiError } from "@/lib/api-response";
import { activeHouseholdCookie, requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { householdSwitchSchema } from "@/lib/household-schema";
import { protectMutation } from "@/lib/request-protection";

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "households:switch");
    const input = householdSwitchSchema.parse(await request.json());
    const membership = await getDb().membership.findFirst({
      where: { userId: context.actorId, householdId: input.householdId },
      include: { household: true },
    });
    if (!membership) throw new ApiResponseError("You are not a member of that household.", 403);
    (await cookies()).set(activeHouseholdCookie, membership.householdId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return Response.json({ data: { id: membership.householdId, name: membership.household.name, role: membership.role } });
  } catch (error) {
    return apiError(error);
  }
}