import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";

const baseUrl = process.env.OIDC_SMOKE_BASE_URL ?? "http://localhost:3000";
const username = process.env.OIDC_SMOKE_USERNAME;
const password = process.env.OIDC_SMOKE_PASSWORD;
const clientId = process.env.OIDC_SMOKE_CLIENT_ID;
const clientSecret = process.env.OIDC_SMOKE_CLIENT_SECRET;
const redirectUri = process.env.OIDC_SMOKE_REDIRECT_URI ?? "http://127.0.0.1:4100/callback";

if (!username || !password || !clientId || !clientSecret) {
  throw new Error(
    "Set OIDC_SMOKE_USERNAME, OIDC_SMOKE_PASSWORD, OIDC_SMOKE_CLIENT_ID and OIDC_SMOKE_CLIENT_SECRET.",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

const signInResponse = await fetch(`${baseUrl}/api/auth/hflive/sign-in`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: baseUrl,
  },
  body: JSON.stringify({ identifier: username, password }),
  redirect: "manual",
});

assert(signInResponse.ok, `Sign-in failed with HTTP ${signInResponse.status}.`);
const cookie = cookieHeader(signInResponse);
assert(cookie, "Sign-in response did not set a session cookie.");

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");
const nonce = randomBytes(16).toString("hex");
const authorizeUrl = new URL("/api/auth/oauth2/authorize", baseUrl);

authorizeUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: "openid profile email offline_access",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  nonce,
}).toString();

const authorizeResponse = await fetch(authorizeUrl, {
  headers: { Cookie: cookie, Accept: "text/html" },
  redirect: "manual",
});
const authorizeData = authorizeResponse.ok
  ? ((await authorizeResponse.json()) as { url?: string })
  : undefined;
const consentLocation = authorizeResponse.headers.get("location") ?? authorizeData?.url;

assert(
  authorizeResponse.ok || (authorizeResponse.status >= 300 && authorizeResponse.status < 400),
  `Authorize endpoint failed with HTTP ${authorizeResponse.status}.`,
);
assert(consentLocation, "Authorize endpoint did not provide a consent location.");

const nextUrl = new URL(consentLocation, baseUrl);
let callbackUrl: URL;

if (nextUrl.pathname === "/consent") {
  const consentResponse = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      accept: true,
      scope: "openid profile email offline_access",
      oauth_query: nextUrl.searchParams.toString(),
    }),
    redirect: "manual",
  });

  assert(consentResponse.ok, `Consent failed with HTTP ${consentResponse.status}.`);
  const consentData = (await consentResponse.json()) as { url?: string };
  assert(consentData.url, "Consent response did not contain a callback URL.");
  callbackUrl = new URL(consentData.url);
} else {
  assert(nextUrl.href.startsWith(redirectUri), `Unexpected authorization redirect: ${nextUrl.href}`);
  callbackUrl = nextUrl;
}

assert(callbackUrl.searchParams.get("state") === state, "OIDC state did not round-trip.");
const code = callbackUrl.searchParams.get("code");
assert(code, "Callback URL did not contain an authorization code.");

const tokenResponse = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  }),
});

assert(tokenResponse.ok, `Token exchange failed with HTTP ${tokenResponse.status}.`);
const tokenData = (await tokenResponse.json()) as {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
};

assert(tokenData.access_token, "Token response did not contain an access token.");
assert(tokenData.id_token, "Token response did not contain an ID token.");
assert(tokenData.refresh_token, "offline_access did not issue a refresh token.");

const [, encodedPayload] = tokenData.id_token.split(".");
assert(encodedPayload, "ID token is not a compact JWT.");
const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  nonce?: string;
  preferred_username?: string;
};

assert(payload.iss === baseUrl, `Unexpected issuer: ${payload.iss ?? "missing"}`);
assert(payload.sub, "ID token is missing sub.");
assert(payload.nonce === nonce, "OIDC nonce did not round-trip.");
assert(payload.preferred_username === username, "ID token is missing the stable preferred_username claim.");

const refreshResponse = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokenData.refresh_token,
  }),
});
assert(refreshResponse.ok, `Refresh exchange failed with HTTP ${refreshResponse.status}.`);
const refreshed = await refreshResponse.json() as { access_token?: string };
assert(refreshed.access_token, "Refresh response did not contain an access token.");

console.info("OIDC authorization code + PKCE and refresh smoke test passed.");
