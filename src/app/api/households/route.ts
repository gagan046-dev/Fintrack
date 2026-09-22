import { cookies } from "next/headers";
import { apiError } from "@/lib/api-response";
import { activeHouseholdCookie, requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { householdCreateSchema } from "@/lib/household-schema";
import { protectMutation } from "@/lib/request-protection";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireHouseholdContext();
    const [memberships, members, invitations] = await Promise.all([
      getDb().membership.findMany({
        where: { userId: context.actorId },
        include: { household: true },
        orderBy: { createdAt: "asc" },
      }),
      getDb().membership.findMany({
        where: { householdId: context.householdId },
        include: { user: true },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      }),
      ["OWNER", "ADMIN"].includes(context.role)
        ? getDb().householdInvitation.findMany({
            where: { householdId: context.householdId, acceptedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    return Response.json({
      data: {
        activeHouseholdId: context.householdId,
        role: context.role,
        households: memberships.map((membership) => ({
          id: membership.householdId,
          name: membership.household.name,
          currency: membership.household.currency,
          role: membership.role,
        })),
        members: members.map((membership) => ({
          id: membership.id,
          userId: membership.userId,
          name: membership.user.name ?? membership.user.email,
          email: membership.user.email,
          role: membership.role,
          joinedAt: membership.createdAt.toISOString(),
        })),
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "households:create", { limit: 5, windowSeconds: 3600 });
    const input = householdCreateSchema.parse(await request.json());
    const household = await getDb().$transaction(async (db) => {
      const created = await db.household.create({
        data: {
          name: input.name,
          currency: input.currency,
          memberships: { create: { userId: context.actorId, role: "OWNER" } },
        },
      });
      await db.auditLog.create({
        data: { householdId: created.id, actorId: context.actorId, action: "CREATE", entityType: "Household", entityId: created.id },
      });
      return created;
    });
    (await cookies()).set(activeHouseholdCookie, household.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return Response.json({ data: { id: household.id, name: household.name, currency: household.currency, role: "OWNER" } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}