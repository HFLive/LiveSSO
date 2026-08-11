import { resolveLoginCallback } from "@/lib/login-callback";

export function resolveAuthenticatedDestination(currentURL: string) {
  const current = new URL(currentURL);
  const callback = resolveLoginCallback(current.href);
  if (!callback) return "/profile";

  const destination = new URL(callback, current.origin);
  if (destination.origin !== current.origin) return "/profile";

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
