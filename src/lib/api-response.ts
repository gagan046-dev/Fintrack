import { ZodError } from "zod";

export class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers?: HeadersInit,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export function apiError(error: unknown) {
  if (error instanceof ApiResponseError) {
    return Response.json({ error: error.message }, { status: error.status, headers: error.headers });
  }

  if (error instanceof ZodError) {
    return Response.json(
      { error: "Validation failed", issues: error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (error instanceof SyntaxError) {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") {
      return Response.json({ error: "This transaction has already been imported." }, { status: 409 });
    }
    if (error.code === "P2025") {
      return Response.json({ error: "The requested record was not found." }, { status: 404 });
    }
  }

  console.error(error);
  return Response.json({ error: "The server could not complete this request." }, { status: 500 });
}