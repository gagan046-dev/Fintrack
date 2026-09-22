import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { ApiResponseError } from "@/lib/api-response";
import { getDb } from "@/lib/db";

const demoHouseholdId = "northstar-demo-household";
const developmentSubject = "development:northstar-demo-user";
export const activeHouseholdCookie = "fintrack-household";
const writerRoles = new Set(["OWNER", "ADMIN", "MEMBER"]);
const adminRoles = new Set(["OWNER", "ADMIN"]);
const globalForDevelopmentAuth = globalThis as unknown as {
  developmentUserIdPromise?: Promise<string>;
};

type AccessLevel = "read" | "write" | "admin" | "owner";

export type HouseholdContext = {
  actorId: string;
  householdId: string;
  householdName: string;
  currency: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  userEmail: string;
  userName: string;
};

export function isClerkConfigured() {
  const developmentAuth = process.env.NODE_ENV === "development" && process.env.FINTRACK_DEVELOPMENT_AUTH === "true";
  return !developmentAuth && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

async function findActiveMembership(userId: string) {
  const requestedHouseholdId = (await cookies()).get(activeHouseholdCookie)?.value;
  if (requestedHouseholdId) {
    const requested = await getDb().membership.findFirst({
      where: { userId, householdId: requestedHouseholdId },
      include: { household: true, user: true },
    });
    if (requested) return requested;
  }
  return getDb().membership.findFirst({
    where: { userId },
    include: { household: true, user: true },
    orderBy: { createdAt: "asc" },
  });
}

function toHouseholdContext(membership: NonNullable<Awaited<ReturnType<typeof findActiveMembership>>>): HouseholdContext {
  return {
    actorId: membership.userId,
    householdId: membership.householdId,
    householdName: membership.household.name,
    currency: membership.household.currency,
    role: membership.role,
    userEmail: membership.user.email,
    userName: membership.user.name ?? membership.user.email,
  };
}

async function bootstrapDevelopmentUser() {
  const user = await getDb().$transaction(async (db) => {
    const user = await db.user.upsert({
      where: { email: "alex@northstar.local" },
      update: { authSubject: developmentSubject, name: "Alex Rivera" },
      create: {
        authSubject: developmentSubject,
        email: "alex@northstar.local",
        name: "Alex Rivera",
      },
    });
    await db.household.upsert({
      where: { id: demoHouseholdId },
      update: {},
      create: { id: demoHouseholdId, name: "Alex's Household", currency: "INR" },
    });
    await db.membership.upsert({
      where: { userId_householdId: { userId: user.id, householdId: demoHouseholdId } },
      update: {},
      create: { userId: user.id, householdId: demoHouseholdId, role: "OWNER" },
    });
    return user;
  }, { maxWait: 10_000, timeout: 15_000 });
  return user.id;
}

async function getDevelopmentContext(): Promise<HouseholdContext> {
  globalForDevelopmentAuth.developmentUserIdPromise ??= bootstrapDevelopmentUser().catch((error) => {
    delete globalForDevelopmentAuth.developmentUserIdPromise;
    throw error;
  });
  const userId = await globalForDevelopmentAuth.developmentUserIdPromise;
  const membership = await findActiveMembership(userId);
  if (!membership) throw new ApiResponseError("Development household is unavailable.", 503);
  return toHouseholdContext(membership);
}

async function getClerkContext(): Promise<HouseholdContext> {
  const session = await auth();
  if (!session.userId) throw new ApiResponseError("Authentication required.", 401);

  const existingUser = await getDb().user.findUnique({ where: { authSubject: session.userId } });
  const existingMembership = existingUser ? await findActiveMembership(existingUser.id) : null;
  if (existingMembership) {
    return toHouseholdContext(existingMembership);
  }

  const identity = await currentUser();
  if (!identity) throw new ApiResponseError("Authentication required.", 401);
  const email = identity.primaryEmailAddress?.emailAddress ?? identity.emailAddresses[0]?.emailAddress;
  if (!email) throw new ApiResponseError("An email address is required to create a FinTrack account.", 422);
  const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ") || identity.username || email;

  return getDb().$transaction(async (db) => {
    const matchedUser = await db.user.findUnique({ where: { authSubject: session.userId } });
    const emailOwner = await db.user.findUnique({ where: { email } });
    if (emailOwner && emailOwner.id !== matchedUser?.id) {
      throw new ApiResponseError("This email address is already linked to another FinTrack account.", 409);
    }
    const user = matchedUser
      ? await db.user.update({ where: { id: matchedUser.id }, data: { email, name } })
      : await db.user.create({ data: { authSubject: session.userId, email, name } });
    const currentMembership = await db.membership.findFirst({
      where: { userId: user.id },
      include: { household: true, user: true },
      orderBy: { createdAt: "asc" },
    });
    if (currentMembership) {
      return {
        actorId: user.id,
        householdId: currentMembership.householdId,
        householdName: currentMembership.household.name,
        currency: currentMembership.household.currency,
        role: currentMembership.role,
        userEmail: user.email,
        userName: user.name ?? user.email,
      };
    }

    const household = await db.household.create({
      data: {
        name: `${name}'s Household`,
        currency: "INR",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    return {
      actorId: user.id,
      householdId: household.id,
      householdName: household.name,
      currency: household.currency,
      role: "OWNER",
      userEmail: user.email,
      userName: user.name ?? user.email,
    };
  });
}

export async function requireHouseholdContext(access: AccessLevel = "read") {
  const context = isClerkConfigured()
    ? await getClerkContext()
    : process.env.NODE_ENV === "development"
      ? await getDevelopmentContext()
      : null;

  if (!context) {
    throw new ApiResponseError("Authentication is not configured.", 503);
  }
  if (access === "write" && !writerRoles.has(context.role)) {
    throw new ApiResponseError("Your household role does not allow this action.", 403);
  }
  if (access === "admin" && !adminRoles.has(context.role)) {
    throw new ApiResponseError("Household administrator access is required.", 403);
  }
  if (access === "owner" && context.role !== "OWNER") {
    throw new ApiResponseError("Household owner access is required.", 403);
  }
  return context;
}