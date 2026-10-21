import { $ } from 'bun';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { CSP } from './src/core/csp';

const OUT = 'docs';
const SHELL = ['index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files.sort();
}

async function sourceVersion(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...(await listFiles('src')), ...(await listFiles('public')), 'build.ts']) {
    hash.update(file);
    hash.update(await Bun.file(file).bytes());
  }
  return hash.digest('hex').slice(0, 12);
}

async function bundle(entry: string, naming: string, format: 'esm' | 'iife', define: Record<string, string>): Promise<void> {
  const result = await Bun.build({ entrypoints: [entry], outdir: OUT, naming, target: 'browser', format, minify: true, define });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`build failed: ${entry}`);
  }
}

const version = await sourceVersion();
await $`rm -rf ${OUT}`;
await $`mkdir -p ${OUT}`;
await $`cp -R public/. ${OUT}/`;
await Bun.write(`${OUT}/.nojekyll`, '');
const html = await Bun.file('public/index.html').text();
if (!html.includes('%CSP%')) throw new Error('public/index.html lost its %CSP% placeholder');
await Bun.write(`${OUT}/index.html`, html.replace('%CSP%', CSP));

const define = { __VERSION__: JSON.stringify(version) };
await bundle('src/app/main.ts', 'app.js', 'esm', define);
await bundle('src/sw.ts', 'sw.js', 'iife', { ...define, __SHELL__: JSON.stringify(SHELL) });

for (const path of SHELL) {
  if (!(await Bun.file(`${OUT}/${path}`).exists())) throw new Error(`shell file missing from ${OUT}: ${path}`);
}
console.log(`built ${OUT}/ version ${version}`);
