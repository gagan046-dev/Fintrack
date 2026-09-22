import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { ApiResponseError, apiError } from "@/lib/api-response";
import { activeHouseholdCookie, requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { invitationAcceptanceSchema } from "@/lib/household-schema";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "households:accept-invite", { limit: 10, windowSeconds: 3600 });
    const input = invitationAcceptanceSchema.parse(await request.json());
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const invitation = await getDb().$transaction(async (db) => {
      const pending = await db.householdInvitation.findUnique({ where: { tokenHash }, include: { household: true } });
      if (!pending || pending.acceptedAt || pending.expiresAt <= new Date()) {
        throw new ApiResponseError("This invitation is invalid or has expired.", 400);
      }
      if (pending.email !== context.userEmail.toLowerCase()) {
        throw new ApiResponseError("This invitation belongs to a different email address.", 403);
      }
      const claimed = await db.householdInvitation.updateMany({
        where: { id: pending.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (!claimed.count) throw new ApiResponseError("This invitation has already been accepted.", 409);
      await db.membership.upsert({
        where: { userId_householdId: { userId: context.actorId, householdId: pending.householdId } },
        update: {},
        create: { userId: context.actorId, householdId: pending.householdId, role: pending.role },
      });
      await db.auditLog.create({
        data: { householdId: pending.householdId, actorId: context.actorId, action: "UPDATE", entityType: "HouseholdInvitation", entityId: pending.id, metadata: { accepted: true } },
      });
      return pending;
    });
    (await cookies()).set(activeHouseholdCookie, invitation.householdId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return Response.json({ data: { householdId: invitation.householdId, householdName: invitation.household.name, role: invitation.role } });
  } catch (error) {
    return apiError(error);
  }
}