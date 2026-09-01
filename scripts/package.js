// Cross-platform packaging script (replaces cp/cd/zip shell pipeline).
// Reuses the `build` script from package.json for bundling.

import { cpSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dir, '..');
const dist = path.join(root, 'dist');
const outfile = path.join(dist, 'index.js');

const proc = Bun.spawnSync(['bun', 'run', 'build'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (proc.exitCode !== 0) {
  process.exit(proc.exitCode);
}

cpSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));

const zipPath = path.join(root, 'google-contacts-sync.zip');
rmSync(zipPath, { force: true });
const zipped = zipSync({
  'manifest.json': readFileSync(path.join(dist, 'manifest.json')),
  'index.js': readFileSync(outfile),
});
await Bun.write(zipPath, zipped);

console.log(`Packaged ${zipPath}`);
