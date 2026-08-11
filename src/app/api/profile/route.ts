import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ProfileNameError,
  updateProfileName,
} from "@/lib/security/profile-service";

const inputSchema = z.object({
  name: z.string().max(160),
});

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "显示名必须为 1–80 个字符。" },
      { status: 400 },
    );
  }

  try {
    const result = await updateProfileName(prisma, {
      userId: session.user.id,
      name: parsed.data.name,
    });
    return NextResponse.json(
      { name: result.name, changed: result.changed },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProfileNameError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Profile name update failed", {
      cause: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "显示名保存失败，请稍后重试。" },
      { status: 500 },
    );
  }
}
