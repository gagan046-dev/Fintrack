import { ApiResponseError, apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { settingsUpdateSchema } from "@/lib/settings-schema";
import { protectMutation } from "@/lib/request-protection";

const defaultPreferences = {
  locale: "en-US",
  weekStartsOn: 0,
  emailNotifications: true,
  budgetAlerts: true,
  goalAlerts: true,
};

export async function GET() {
  try {
    const context = await requireHouseholdContext();
    const [user, household] = await Promise.all([
      getDb().user.findUniqueOrThrow({ where: { id: context.actorId }, include: { preferences: true } }),
      getDb().household.findUniqueOrThrow({ where: { id: context.householdId } }),
    ]);
    const preferences = user.preferences ?? defaultPreferences;
    return Response.json({
      data: {
        name: user.name ?? "",
        email: user.email,
        currency: household.currency,
        role: context.role,
        locale: preferences.locale,
        weekStartsOn: preferences.weekStartsOn,
        emailNotifications: preferences.emailNotifications,
        budgetAlerts: preferences.budgetAlerts,
        goalAlerts: preferences.goalAlerts,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireHouseholdContext();
    await protectMutation(request, context.actorId, "settings:update");
    const input = settingsUpdateSchema.parse(await request.json());
    if (input.currency && !["OWNER", "ADMIN"].includes(context.role)) {
      throw new ApiResponseError("Only a household administrator can change its currency.", 403);
    }
    const { name, currency, ...preferences } = input;
    await getDb().$transaction(async (db) => {
      if (name !== undefined) await db.user.update({ where: { id: context.actorId }, data: { name } });
      if (currency !== undefined) await db.household.update({ where: { id: context.householdId }, data: { currency } });
      if (Object.keys(preferences).length) {
        await db.userPreference.upsert({
          where: { userId: context.actorId },
          update: preferences,
          create: { userId: context.actorId, ...preferences },
        });
      }
      await db.auditLog.create({
        data: { householdId: context.householdId, actorId: context.actorId, action: "UPDATE", entityType: "Settings", entityId: context.actorId, metadata: { ...input, email: undefined } },
      });
    });
    return GET();
  } catch (error) {
    return apiError(error);
  }
}