import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

export async function DELETE(request: Request, { params }: RouteContext<"/api/households/invitations/[id]">) {
  try {
    const context = await requireHouseholdContext("admin");
    await protectMutation(request, context.actorId, "households:invite");
    const { id } = await params;
    const invitation = await getDb().householdInvitation.findFirst({ where: { id, householdId: context.householdId, acceptedAt: null } });
    if (!invitation) return Response.json({ error: "Invitation not found." }, { status: 404 });
    await getDb().$transaction(async (db) => {
      await db.householdInvitation.delete({ where: { id, householdId: context.householdId } });
      await db.auditLog.create({
        data: { householdId: context.householdId, actorId: context.actorId, action: "DELETE", entityType: "HouseholdInvitation", entityId: id, metadata: { email: invitation.email, role: invitation.role } },
      });
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}