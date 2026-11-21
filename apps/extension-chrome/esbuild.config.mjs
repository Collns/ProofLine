import { build } from 'esbuild';
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const outdir = 'dist';
if (existsSync(outdir)) await rm(outdir, { recursive: true });
await mkdir(outdir, { recursive: true });

// PFL-183/staging: let the build point the extension at another environment
// without editing src/shared/config.ts. Each var falls back to production in
// config.ts when unset, so a normal `pnpm build` is unchanged. No secrets —
// these are public origins only.
const define = Object.fromEntries(
  ['EXT_API_ORIGIN', 'EXT_SIGN_ORIGIN', 'EXT_RP_ID', 'EXT_VERIFY_BASE_URL'].map((k) => [
    `process.env.${k}`,
    JSON.stringify(process.env[k] ?? ''),
  ]),
);

const common = { bundle: true, target: 'chrome120', minify: false, sourcemap: 'inline', define };

await Promise.all([
  build({ ...common, entryPoints: ['src/content/index.ts'],    outfile: `${outdir}/content.js`,    format: 'iife' }),
  build({ ...common, entryPoints: ['src/background/index.ts'], outfile: `${outdir}/background.js`, format: 'esm'  }),
  build({ ...common, entryPoints: ['src/popup/popup.ts'],      outfile: `${outdir}/popup.js`,      format: 'iife' }),
]);

// PFL-188: when the build points at another environment (EXT_API_ORIGIN /
// EXT_SIGN_ORIGIN), add those origins to host_permissions so the background
// SW can reach them without a CORS preflight, and let the sign popup connect.
// A normal `pnpm build` (no env vars) ships the manifest unchanged.
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
// PFL-190 #7: stamp the real version from package.json so the popup shows it
// (the checked-in manifest keeps a 0.0.0 placeholder). Single source of truth.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.version) manifest.version = pkg.version;
const asHostGlob = (value) => {
  try { return `${new URL(value).origin}/*`; } catch { return null; }
};
const extraHosts = [asHostGlob(process.env.EXT_API_ORIGIN), asHostGlob(process.env.EXT_SIGN_ORIGIN)].filter(Boolean);
for (const h of extraHosts) {
  if (!manifest.host_permissions.includes(h)) manifest.host_permissions.push(h);
}
const signGlob = asHostGlob(process.env.EXT_SIGN_ORIGIN);
if (signGlob && Array.isArray(manifest.externally_connectable?.matches) && !manifest.externally_connectable.matches.includes(signGlob)) {
  manifest.externally_connectable.matches.push(signGlob);
}
await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
await copyFile('public/popup.html', `${outdir}/popup.html`);
for (const size of [16, 48, 128]) {
  await copyFile(`public/icon-${size}.png`, `${outdir}/icon-${size}.png`);
}

console.log(`Extension built to ${outdir}/`);
