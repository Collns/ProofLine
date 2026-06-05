/**
 * @file esbuild.config.mjs
 * @module apps/functions
 *
 * Bundles src/index.ts → dist/index.js so Firebase Functions can deploy
 * a self-contained app. Why we bundle:
 *
 *   apps/functions depends on packages/* through `workspace:*` refs.
 *   Firebase deploy uploads the source directory to GCS and runs
 *   `npm install` in the cloud — `workspace:*` is not npm-resolvable
 *   there, so the install would fail.
 *
 *   esbuild inlines every workspace dep into a single file. Only true
 *   npm packages (firebase-functions, firebase-admin, express) remain
 *   external; we emit a clean dist/package.json that declares exactly
 *   those externals, and firebase.json points its `source` at dist/.
 *
 * Build outputs:
 *   dist/index.js         — bundled ESM
 *   dist/index.js.map     — inline source map (debugging in Cloud Logs)
 *   dist/package.json     — runtime deps only (no workspace refs)
 *   dist/.gcloudignore    — keeps the upload tight
 */

import { build } from "esbuild";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const requireFromHere = createRequire(import.meta.url);
const sourcePkg = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
);

const outdir = "dist";
if (existsSync(outdir)) await rm(outdir, { recursive: true });
await mkdir(outdir, { recursive: true });

// Packages that MUST be resolved by Cloud's runtime npm (either because
// Firebase introspects them, or because they have native bindings esbuild
// can't safely inline).
const EXTERNAL_PACKAGES = [
  "firebase-functions",
  "firebase-functions/v2/https",
  "firebase-functions/v2/scheduler",
  "firebase-admin",
  "firebase-admin/app",
  "firebase-admin/firestore",
  "express",
  // PFL-126: native gRPC bindings + a large transitive tree. Cheaper and
  // more reliable to let Cloud's runtime npm install it from
  // dist/package.json than to inline ~30MB into the function bundle.
  "@google-cloud/kms",
];

// Express has internal dynamic requires that esbuild can't fully bundle
// safely — keep it external so the runtime resolves it normally.
const externalNamespaces = ["firebase-functions", "firebase-admin"];
function externalFilter(name) {
  if (EXTERNAL_PACKAGES.includes(name)) return true;
  return externalNamespaces.some((ns) => name === ns || name.startsWith(`${ns}/`));
}

await build({
  entryPoints: ["src/index.ts"],
  outfile:     `${outdir}/index.js`,
  bundle:      true,
  format:      "esm",
  platform:    "node",
  target:      "node20",
  // Resolve workspace deps from this app's node_modules (pnpm symlinks),
  // not the bundled output's. Without this, esbuild walks up and finds
  // the same files but the diagnostic paths get noisier.
  resolveExtensions: [".ts", ".mjs", ".js", ".json"],
  external:    EXTERNAL_PACKAGES,
  // Inline source maps make Cloud Logs stack traces useful without a
  // separate .map upload step.
  sourcemap:   "inline",
  minify:      false,
  // ESM in Node 20: tell esbuild to keep import.meta and dynamic import
  // intact (firebase-functions internals use both).
  banner: {
    js:
      "import { createRequire as __pflCreateRequire } from 'module';" +
      "const require = __pflCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});

// ─── Generate dist/package.json ──────────────────────────────────────────────
//
// Only declare npm-resolvable deps (no workspace:* refs). Versions are
// pinned from the source package.json so dev and prod stay aligned.

function pickDep(name) {
  const v = sourcePkg.dependencies?.[name];
  if (!v || v.startsWith("workspace:")) {
    throw new Error(`esbuild bundle: missing runtime dep '${name}' in apps/functions/package.json`);
  }
  return v;
}

const distPkg = {
  name:    sourcePkg.name,
  version: sourcePkg.version,
  private: true,
  type:    "module",
  main:    "index.js",
  engines: { node: "20" },
  dependencies: {
    express:             pickDep("express"),
    "firebase-admin":    pickDep("firebase-admin"),
    "firebase-functions": pickDep("firebase-functions"),
    "@google-cloud/kms": pickDep("@google-cloud/kms"),
  },
};

await writeFile(`${outdir}/package.json`, JSON.stringify(distPkg, null, 2) + "\n");

// Minimal .gcloudignore — the bundle is the upload. IMPORTANT: we do NOT
// exclude node_modules/ here, because Firebase CLI scans the deployed
// source dir for `firebase-functions` in node_modules/ to locate the SDK
// version. Excluding it produces "Failed to find location of Firebase
// Functions SDK" at deploy time.
await writeFile(
  `${outdir}/.gcloudignore`,
  [
    ".gcloudignore",
    ".git",
    "*.local",
    "firebase-debug.*.log",
  ].join("\n") + "\n",
);

// ─── Promote runtime env from .env.local → dist/.env ─────────────────────────
//
// Firebase Functions v2 reads `.env` from the deployed source directory at
// build time and surfaces those keys as process.env in the runtime. We
// promote only the keys the runtime actually needs (anchor + chain) from
// the repo-root `.env.local` so secrets that don't belong on the function
// (e.g. third-party API keys for the local dev stack) don't leak into the
// deploy bundle.
const RUNTIME_ENV_KEYS = [
  "BASE_SEPOLIA_RPC",
  "DEPLOYER_PRIVATE_KEY",
  "ANCHOR_CONTRACT_ADDRESS",
  "ANCHOR_CHAIN_ID",
  "FIREBASE_PROJECT_ID",
  "KMS_KEYRING",
  "KMS_LOCATION",
];

async function readDotenv(path) {
  try {
    const text = await readFile(path, "utf8");
    const map = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      // Strip optional surrounding quotes.
      if ((v.startsWith('"') && v.endsWith('"'))
          || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      map[k] = v;
    }
    return map;
  } catch {
    return null;
  }
}

const repoEnvLocal = new URL("../../.env.local", import.meta.url);
const sourceEnv = (await readDotenv(repoEnvLocal)) ?? {};
const promoted = [];
for (const key of RUNTIME_ENV_KEYS) {
  const v = sourceEnv[key];
  if (typeof v === "string" && v.length > 0) promoted.push(`${key}=${v}`);
}
if (promoted.length > 0) {
  await writeFile(`${outdir}/.env`, promoted.join("\n") + "\n");
  console.log(`Promoted ${promoted.length} env keys to ${outdir}/.env`);
} else {
  console.warn(
    "[esbuild] no runtime env keys found in .env.local — deploy will use stubs",
  );
}

console.log(`Functions bundled to ${outdir}/ (entry: index.js)`);

// Sanity log: warn if any workspace symbol leaked into the bundle path.
const bundle = await readFile(`${outdir}/index.js`, "utf8");
if (bundle.includes('"workspace:')) {
  console.warn("[esbuild] bundle contains 'workspace:' literal — inspect imports");
}

// Touch requireFromHere so the import isn't tree-shaken in strict mode.
void requireFromHere;

// ─── Install runtime deps in dist/ ───────────────────────────────────────────
//
// Why: Firebase CLI (firebase-tools) introspects the deployed source
// directory for `firebase-functions` in node_modules/ to discover the SDK
// version and the v1/v2 wiring shape. Our bundle marks firebase-functions
// as external, so the bundle itself imports the package by name — both
// the CLI and the Cloud runtime need a real install to resolve it.
//
// We install ONLY the (small) runtime deps declared in dist/package.json,
// not the workspace + dev tree of the source. This adds ~10–15s to the
// build but keeps the deployed artifact self-contained and CLI-compatible.
console.log("Installing runtime deps in dist/ for Firebase CLI introspection…");
execSync("npm install --omit=dev --no-audit --no-fund --silent", {
  cwd:   outdir,
  stdio: "inherit",
});
console.log("Runtime deps installed in dist/node_modules/.");
