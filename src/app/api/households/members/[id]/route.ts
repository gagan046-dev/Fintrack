import { ApiResponseError, apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { membershipRoleSchema } from "@/lib/household-schema";
import { protectMutation } from "@/lib/request-protection";

export async function PATCH(request: Request, { params }: RouteContext<"/api/households/members/[id]">) {
  try {
    const context = await requireHouseholdContext("admin");
    await protectMutation(request, context.actorId, "households:members");
    const { id } = await params;
    const input = membershipRoleSchema.parse(await request.json());
    const target = await getDb().membership.findFirst({ where: { id, householdId: context.householdId } });
    if (!target) return Response.json({ error: "Household member not found." }, { status: 404 });
    if (target.role === "OWNER") throw new ApiResponseError("The household owner role cannot be changed here.", 403);
    if (context.role === "ADMIN" && (target.role === "ADMIN" || input.role === "ADMIN")) {
      throw new ApiResponseError("Only the owner can manage administrator roles.", 403);
    }
    const membership = await getDb().$transaction(async (db) => {
      const updated = await db.membership.update({ where: { id, householdId: context.householdId }, data: { role: input.role } });
      await db.auditLog.create({
        data: { householdId: context.householdId, actorId: context.actorId, action: "UPDATE", entityType: "Membership", entityId: id, metadata: { from: target.role, to: input.role } },
      });
      return updated;
    });
    return Response.json({ data: { id: membership.id, role: membership.role } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/households/members/[id]">) {
  try {
    const context = await requireHouseholdContext("admin");
    await protectMutation(request, context.actorId, "households:members");
    const { id } = await params;
    const target = await getDb().membership.findFirst({ where: { id, householdId: context.householdId }, include: { user: true } });
    if (!target) return Response.json({ error: "Household member not found." }, { status: 404 });
    if (target.userId === context.actorId) throw new ApiResponseError("You cannot remove yourself from the active household.", 400);
    if (target.role === "OWNER") throw new ApiResponseError("The household owner cannot be removed.", 403);
    if (context.role === "ADMIN" && target.role === "ADMIN") throw new ApiResponseError("Only the owner can remove an administrator.", 403);
    await getDb().$transaction(async (db) => {
      await db.membership.delete({ where: { id, householdId: context.householdId } });
      await db.auditLog.create({
        data: { householdId: context.householdId, actorId: context.actorId, action: "DELETE", entityType: "Membership", entityId: id, metadata: { email: target.user.email } },
      });
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}