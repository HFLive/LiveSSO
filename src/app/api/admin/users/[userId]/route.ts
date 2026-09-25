import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { updateUsername, usernameSchema, UsernameUpdateError } from "@/lib/security/username-service";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/security/admin";
import { setUserAccountStatus } from "@/lib/security/client-service";

const inputSchema = z.union([
  z.object({ accountStatus: z.enum(["ACTIVE", "DISABLED"]) }).strict(),
  z.object({ username: usernameSchema }).strict(),
]);
export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { userId } = await context.params;
  if (!z.uuid().safeParse(userId).success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if ("username" in parsed.data) {
    try {
      return NextResponse.json(await updateUsername(prisma, { actorUserId: authorization.actor.id, userId, username: parsed.data.username }));
    } catch (error) {
      if (error instanceof UsernameUpdateError) {
        const status = { INVALID_USERNAME: 400, USERNAME_TAKEN: 409, USER_NOT_FOUND: 404, FORBIDDEN: 403 }[error.code];
        return NextResponse.json({ error: error.code }, { status });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
        return NextResponse.json({ error: error.code === "P2002" ? "USERNAME_TAKEN" : "RETRY_UPDATE" }, { status: 409 });
      }
      return NextResponse.json({ error: "USER_UPDATE_FAILED" }, { status: 500 });
    }
  }
  if (userId === authorization.actor.id && parsed.data.accountStatus === "DISABLED") return NextResponse.json({ error: "CANNOT_DISABLE_SELF" }, { status: 409 });
  try {
    const user = await setUserAccountStatus(prisma, { actorUserId: authorization.actor.id, subjectUserId: userId, status: parsed.data.accountStatus });
    return NextResponse.json({ id: user.id, accountStatus: user.accountStatus });
  } catch {
    return NextResponse.json({ error: "USER_UPDATE_FAILED" }, { status: 404 });
  }
}
