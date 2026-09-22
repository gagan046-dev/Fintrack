import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { protectMutation } from "@/lib/request-protection";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ daysBeforeDue: z.number().int().min(0).max(30).optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, { params }: Context) { try { const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "reminders:update"); const { id } = await params; const input = schema.parse(await request.json()); const result = await getDb().reminderSchedule.updateMany({ where: { id, householdId }, data: input }); return result.count ? Response.json({ data: { id } }) : Response.json({ error: "Reminder not found." }, { status: 404 }); } catch (error) { return apiError(error); } }
export async function DELETE(request: Request, { params }: Context) { try { const { actorId, householdId } = await requireHouseholdContext("write"); await protectMutation(request, actorId, "reminders:delete"); const { id } = await params; const result = await getDb().reminderSchedule.deleteMany({ where: { id, householdId } }); return result.count ? new Response(null, { status: 204 }) : Response.json({ error: "Reminder not found." }, { status: 404 }); } catch (error) { return apiError(error); } }