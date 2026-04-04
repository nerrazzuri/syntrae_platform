import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of [
  'index.html',
  'styles.css',
  'robots.txt',
  'sitemap.xml',
  'manifest.webmanifest',
  'icon.svg',
  'og-image.svg',
]) {
  cpSync(resolve(root, entry), resolve(dist, entry));
}
