const SUPPORTED_PROVIDERS = new Set(["vercel", "edgeone"]);

type StaticAssetEnvironment = Readonly<Record<string, string | undefined>>;

const readValue = (environment: StaticAssetEnvironment, name: string) =>
  environment[name]?.trim() || undefined;

function normalizeOrigin(value: string, variableName: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid HTTPS origin.`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${variableName} must be an HTTPS origin without credentials, path, query, or fragment.`,
    );
  }

  return parsed.origin;
}

function readProjectName(environment: StaticAssetEnvironment) {
  const projectName = readValue(environment, "EDGEONE_PROJECT_NAME") || "hflive-auth-static-eo";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(projectName)) {
    throw new Error("EDGEONE_PROJECT_NAME has an invalid format.");
  }
  return projectName;
}

export type StaticAssetConfig =
  | { provider: "vercel"; assetPrefix?: undefined }
  | {
      provider: "edgeone";
      assetPrefix: string;
      projectName: string;
    };

export function resolveStaticAssetConfig(
  environment: StaticAssetEnvironment = process.env,
): StaticAssetConfig {
  const provider = readValue(environment, "STATIC_ASSET_PROVIDER") || "vercel";
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error("STATIC_ASSET_PROVIDER must be vercel or edgeone.");
  }

  if (provider === "vercel") {
    return { provider, assetPrefix: undefined };
  }

  const configuredOrigin = readValue(environment, "EDGEONE_ASSET_ORIGIN");
  if (!configuredOrigin) {
    throw new Error("STATIC_ASSET_PROVIDER=edgeone requires EDGEONE_ASSET_ORIGIN.");
  }

  return {
    provider: "edgeone",
    assetPrefix: normalizeOrigin(configuredOrigin, "EDGEONE_ASSET_ORIGIN"),
    projectName: readProjectName(environment),
  };
}
