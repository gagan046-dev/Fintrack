import { z } from "zod";

export const settingsUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  locale: z.enum(["en-IN", "en-US", "en-GB", "de-DE", "fr-FR"]).optional(),
  weekStartsOn: z.number().int().min(0).max(1).optional(),
  emailNotifications: z.boolean().optional(),
  budgetAlerts: z.boolean().optional(),
  goalAlerts: z.boolean().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "INR", "CAD", "AUD"]).optional(),
}).refine((settings) => Object.keys(settings).length > 0, "At least one setting is required.");