import type { PrismaClient } from "@/generated/prisma/client";

export function normalizeProfileReturnTo(value: string | undefined, allowedOrigins: Iterable<string>) {
  if (!value) return undefined;

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return undefined;
  }

  if (target.username || target.password || target.protocol !== "https:") return undefined;
  if (!new Set(allowedOrigins).has(target.origin)) return undefined;
  target.hash = "";
  return target.toString();
}

export async function resolveProfileReturnTo(database: PrismaClient, value: string | undefined) {
  const clients = await database.oauthClient.findMany({
    where: { approvalStatus: "APPROVED", disabled: false },
    select: { redirectUris: true },
  });
  const allowedOrigins = clients.flatMap((client) => client.redirectUris.map((uri) => new URL(uri).origin));
  return normalizeProfileReturnTo(value, allowedOrigins);
}
