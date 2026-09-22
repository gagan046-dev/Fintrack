import { z } from "zod";

export const householdCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a three-letter currency code.").default("INR"),
});

export const householdSwitchSchema = z.object({
  householdId: z.string().trim().min(1),
});

export const householdInvitationSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export const invitationAcceptanceSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

export const membershipRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});