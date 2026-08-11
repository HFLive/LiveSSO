export function resolveLoginCallback(currentURL: string) {
  const current = new URL(currentURL);
  const explicit = current.searchParams.get("callbackURL");
  if (explicit) return explicit;

  const isAuthorizationRequest =
    current.searchParams.has("client_id") &&
    ((current.searchParams.get("response_type") === "code" &&
      current.searchParams.has("redirect_uri")) ||
      (current.searchParams.has("code") && current.searchParams.has("state")));

  if (!isAuthorizationRequest) return undefined;

  const authorizationURL = new URL("/api/auth/oauth2/authorize", current.origin);
  authorizationURL.search = current.search;
  return authorizationURL.href;
}
