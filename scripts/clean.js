// Cross-platform workspace clean: removes build artifacts.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

const targets = [path.join(root, 'dist'), path.join(root, 'google-contacts-sync.zip')];

for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`Removed ${path.relative(root, target)}`);
  }
}
