import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { ApiResponseError } from "@/lib/api-response";
import { getDb } from "@/lib/db";

type RateLimitOptions = {
  limit?: number;
  windowSeconds?: number;
};

function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApiResponseError("Cross-site requests are not allowed.", 403);
  }
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) {
    if (fetchSite === "same-origin") return;
    throw new ApiResponseError("Request origin is required.", 403);
  }
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) {
    try {
      allowedOrigins.add(new URL(process.env.APP_URL).origin);
    } catch {
      throw new ApiResponseError("APP_URL is not configured correctly.", 503);
    }
  }
  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    throw new ApiResponseError("Request origin is invalid.", 403);
  }
  if (!allowedOrigins.has(sourceOrigin)) {
    throw new ApiResponseError("Request origin is not allowed.", 403);
  }
}

export async function protectMutation(
  request: Request,
  actorId: string,
  scope: string,
  { limit = 60, windowSeconds = 60 }: RateLimitOptions = {},
) {
  assertSameOrigin(request);
  const key = `${actorId}:${scope}`;
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const updated = await getDb().$queryRaw<Array<{ count: number; resetAt: Date }>>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
      "updatedAt" = NOW()
    WHERE "RateLimitBucket"."resetAt" <= ${now} OR "RateLimitBucket"."count" < ${limit}
    RETURNING "count", "resetAt"
  `);
  if (!updated.length) {
    const bucket = await getDb().rateLimitBucket.findUnique({ where: { key }, select: { resetAt: true } });
    const retryAfter = Math.max(1, Math.ceil(((bucket?.resetAt ?? resetAt).getTime() - now.getTime()) / 1000));
    throw new ApiResponseError("Too many requests. Try again shortly.", 429, { "Retry-After": String(retryAfter) });
  }
}