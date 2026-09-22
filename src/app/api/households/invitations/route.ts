import { createHash, randomBytes } from "node:crypto";
import { ApiResponseError, apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { householdInvitationSchema } from "@/lib/household-schema";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext("admin");
    await protectMutation(request, context.actorId, "households:invite", { limit: 10, windowSeconds: 3600 });
    const input = householdInvitationSchema.parse(await request.json());
    if (context.role === "ADMIN" && input.role === "ADMIN") {
      throw new ApiResponseError("Only an owner can invite another administrator.", 403);
    }
    const existingMember = await getDb().membership.findFirst({
      where: { householdId: context.householdId, user: { email: input.email } },
      select: { id: true },
    });
    if (existingMember) throw new ApiResponseError("This person is already a household member.", 409);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await getDb().$transaction(async (db) => {
      await db.householdInvitation.deleteMany({
        where: { householdId: context.householdId, email: input.email, acceptedAt: null },
      });
      const created = await db.householdInvitation.create({
        data: { householdId: context.householdId, email: input.email, role: input.role, tokenHash, invitedById: context.actorId, expiresAt },
      });
      await db.auditLog.create({
        data: { householdId: context.householdId, actorId: context.actorId, action: "INVITE", entityType: "HouseholdInvitation", entityId: created.id, metadata: { email: input.email, role: input.role } },
      });
      return created;
    });
    return Response.json({
      data: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        invitePath: `/?invitation=${encodeURIComponent(token)}`,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}