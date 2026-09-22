import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const context = await requireHouseholdContext();
    const [notifications, unreadCount] = await Promise.all([
      getDb().notification.findMany({
        where: { userId: context.actorId, householdId: context.householdId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      getDb().notification.count({ where: { userId: context.actorId, householdId: context.householdId, readAt: null } }),
    ]);
    return Response.json({
      data: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type.toLowerCase(),
        title: notification.title,
        message: notification.message,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (error) {
    return apiError(error);
  }
}