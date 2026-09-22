import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

export async function PATCH(request: Request, { params }: RouteContext<"/api/notifications/[id]">) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "notifications:update");
    const { id } = await params;
    const notification = await getDb().notification.findFirst({ where: { id, userId: context.actorId, householdId: context.householdId } });
    if (!notification) return Response.json({ error: "Notification not found." }, { status: 404 });
    const updated = await getDb().notification.update({ where: { id }, data: { readAt: notification.readAt ?? new Date() } });
    return Response.json({ data: { id: updated.id, readAt: updated.readAt?.toISOString() ?? null } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/notifications/[id]">) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "notifications:delete");
    const { id } = await params;
    const notification = await getDb().notification.findFirst({ where: { id, userId: context.actorId, householdId: context.householdId }, select: { id: true } });
    if (!notification) return Response.json({ error: "Notification not found." }, { status: 404 });
    await getDb().notification.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}