import { NoSuchKey } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getProfileObject } from "@/lib/object-storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const noStoreHeaders = { "cache-control": "private, no-store" };
const userIdSchema = z.uuid();

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const versionText = new URL(request.url).searchParams.get("v");
  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json(
      { error: "A valid avatar version is required." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const { userId } = await context.params;
  if (!userIdSchema.safeParse(userId).success) {
    return NextResponse.json(
      { error: "A valid user identifier is required." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const asset = await prisma.profileAsset.findFirst({
    where: { userId, version, status: { in: ["ACTIVE", "REPLACED"] } },
    select: { objectKey: true, contentType: true, checksum: true },
  });
  if (!asset) return new NextResponse(null, { status: 404, headers: noStoreHeaders });
  try {
    const object = await getProfileObject(asset.objectKey);
    if (!object.Body) return new NextResponse(null, { status: 404, headers: noStoreHeaders });
    return new NextResponse(object.Body.transformToWebStream(), { headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      etag: `"sha256-${asset.checksum}"`,
    } });
  } catch (error) {
    if (error instanceof NoSuchKey || (error instanceof Error && error.name === "NoSuchKey")) {
      return new NextResponse(null, { status: 404, headers: noStoreHeaders });
    }
    return NextResponse.json(
      { error: "Avatar unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
