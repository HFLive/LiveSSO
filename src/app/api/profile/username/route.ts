import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeOwnUsernameAttempt, updateOwnUsername, usernameSchema, UsernameUpdateError } from "@/lib/security/username-service";

const inputSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict();

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  try {
    if (!await consumeOwnUsernameAttempt(prisma, session.user.id)) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const result = await updateOwnUsername(prisma, { userId: session.user.id, ...parsed.data });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UsernameUpdateError) {
      const status = {
        INVALID_USERNAME: 400,
        USERNAME_TAKEN: 409,
        USER_NOT_FOUND: 404,
        FORBIDDEN: 403,
        INVALID_PASSWORD: 401,
      }[error.code];
      return NextResponse.json({ error: error.code }, { status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      return NextResponse.json({ error: error.code === "P2002" ? "USERNAME_TAKEN" : "RETRY_UPDATE" }, { status: 409 });
    }
    console.error("Profile username update failed", { cause: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "USER_UPDATE_FAILED" }, { status: 500 });
  }
}
