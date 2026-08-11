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

export function profileReturnClientLabel(name: string | null, hostname: string) {
  if (hostname === "board.hsfz.live") return "LiveBoard";
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName.replace(/\s+Production$/i, "") || trimmedName;
  return hostname;
}

export async function resolveProfileReturnTarget(database: PrismaClient, value: string | undefined) {
  if (!value) return undefined;

  const clients = await database.oauthClient.findMany({
    where: { approvalStatus: "APPROVED", disabled: false },
    select: { name: true, redirectUris: true },
  });

  for (const client of clients) {
    const allowedOrigins = client.redirectUris.flatMap((uri) => {
      try {
        return [new URL(uri).origin];
      } catch {
        return [];
      }
    });
    const url = normalizeProfileReturnTo(value, allowedOrigins);
    if (url) {
      return {
        url,
        appName: profileReturnClientLabel(client.name, new URL(url).hostname),
      };
    }
  }

  return undefined;
}
