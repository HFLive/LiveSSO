import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { resolveStaticAssetConfig } from "./static-assets-config";

const isVercelProduction =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (!isVercelProduction) {
  console.info("[static-assets] Skipping external upload outside Vercel Production.");
  process.exit(0);
}

const config = resolveStaticAssetConfig();
if (config.provider === "vercel") {
  console.info("[static-assets] Using Vercel native static assets.");
  process.exit(0);
}

const edgeOneApiToken = process.env.EDGEONE_API_TOKEN?.trim();
if (!edgeOneApiToken) {
  throw new Error("[static-assets] STATIC_ASSET_PROVIDER=edgeone requires EDGEONE_API_TOKEN.");
}

function run(command: string, args: string[], failureLabel: string) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[static-assets] ${failureLabel} (exit ${result.status ?? "unknown"}).`);
  }
}

function findFirstFile(
  directory: string,
  matches: (path: string) => boolean = () => true,
): string | undefined {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedFile: string | undefined = findFirstFile(entryPath, matches);
      if (nestedFile) return nestedFile;
    } else if (entry.isFile() && matches(entryPath)) {
      return entryPath;
    }
  }
  return undefined;
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isJavaScriptContentType = (value: string | null) =>
  /^(?:application|text)\/(?:javascript|ecmascript)(?:\s*;|$)/i.test(value || "");

async function verifyPublishedAssets(sourceStaticDir: string, distDir: string) {
  const buildIdPath = join(process.cwd(), distDir, "BUILD_ID");
  const buildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : undefined;
  const buildManifest = buildId
    ? join(sourceStaticDir, buildId, "_buildManifest.js")
    : undefined;
  const firstFile =
    buildManifest && existsSync(buildManifest) ? buildManifest : findFirstFile(sourceStaticDir);
  if (!firstFile) {
    throw new Error("[static-assets] The Next.js static directory contains no verifiable file.");
  }

  const verificationFiles = [firstFile];
  const moduleFile = findFirstFile(sourceStaticDir, (path) => path.endsWith(".mjs"));
  if (moduleFile && moduleFile !== firstFile) verificationFiles.push(moduleFile);

  for (const verificationFile of verificationFiles) {
    const relativePath = relative(sourceStaticDir, verificationFile).split(sep).join("/");
    const expectedContent = readFileSync(verificationFile);
    const verificationUrl = new URL(`/_next/static/${relativePath}`, config.assetPrefix);
    verificationUrl.searchParams.set(
      "hflive-deployment",
      process.env.VERCEL_GIT_COMMIT_SHA?.trim() || Date.now().toString(),
    );
    const requiresJavaScriptContentType = /\.m?js$/i.test(verificationFile);

    let lastFailure = "unknown";
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const response = await fetch(verificationUrl, {
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (requiresJavaScriptContentType && !isJavaScriptContentType(contentType)) {
            lastFailure = `invalid JavaScript Content-Type (${contentType || "missing"})`;
          } else {
            const actualContent = Buffer.from(await response.arrayBuffer());
            if (actualContent.equals(expectedContent)) {
              console.info(`[static-assets] Verified /_next/static/${relativePath}.`);
              break;
            }
            lastFailure = "published bytes do not match this build";
          }
        } else {
          lastFailure = `HTTP ${response.status}`;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      if (attempt === 6) {
        throw new Error(
          `[static-assets] ${config.assetPrefix} did not publish /_next/static/${relativePath}: ${lastFailure}.`,
        );
      }
      await wait(3_000);
    }
  }
}

const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const sourceStaticDir = join(process.cwd(), distDir, "static");
if (!existsSync(sourceStaticDir)) {
  throw new Error(`[static-assets] Next.js static directory not found: ${sourceStaticDir}.`);
}

const stageDir = mkdtempSync(join(tmpdir(), "hflive-auth-static-assets-"));
try {
  const nextDir = join(stageDir, "_next");
  mkdirSync(nextDir, { recursive: true });
  cpSync(sourceStaticDir, join(nextDir, "static"), { recursive: true });

  const staticHeaders = [
    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    { key: "Access-Control-Allow-Origin", value: "*" },
    { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
  ];
  writeFileSync(
    join(stageDir, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>HFLive Auth Static Assets</title></head><body>HFLive Auth static asset host.</body></html>\n',
    "utf8",
  );
  writeFileSync(
    join(stageDir, "edgeone.json"),
    `${JSON.stringify(
      {
        headers: [
          {
            source: "/_next/static/*.mjs",
            headers: [
              ...staticHeaders,
              { key: "Content-Type", value: "application/javascript; charset=utf-8" },
            ],
          },
          { source: "/_next/static/*", headers: staticHeaders },
          { source: "/", headers: [{ key: "Cache-Control", value: "no-store" }] },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.info("[static-assets] Uploading this build to EdgeOne Makers.");
  run(
    "pnpm",
    [
      "dlx",
      "edgeone@1.6.19",
      "makers",
      "deploy",
      stageDir,
      "--name",
      config.projectName,
      "--token",
      edgeOneApiToken,
      "--env",
      "production",
      "--area",
      "overseas",
    ],
    "EdgeOne Makers upload failed",
  );
  await verifyPublishedAssets(sourceStaticDir, distDir);
  console.info(`[static-assets] Published ${config.assetPrefix}.`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
