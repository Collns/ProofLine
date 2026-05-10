import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const outdir = 'dist';
if (existsSync(outdir)) await rm(outdir, { recursive: true });
await mkdir(outdir, { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/content/index.ts'],
    outfile: `${outdir}/content.js`,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    minify: false,
    sourcemap: 'inline',
  }),
  build({
    entryPoints: ['src/background/index.ts'],
    outfile: `${outdir}/background.js`,
    bundle: true,
    format: 'esm',
    target: 'chrome120',
    minify: false,
    sourcemap: 'inline',
  }),
  build({
    entryPoints: ['src/popup/popup.ts'],
    outfile: `${outdir}/popup.js`,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    minify: false,
    sourcemap: 'inline',
  }),
]);

await copyFile('manifest.json', `${outdir}/manifest.json`);
await copyFile('public/popup.html', `${outdir}/popup.html`);
for (const size of [16, 48, 128]) {
  await copyFile(`public/icon-${size}.png`, `${outdir}/icon-${size}.png`);
}

console.log(`Extension built to ${outdir}/`);
