import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const cleanOnly = process.argv.includes('--clean');

function buildCommonManifest({ includeLocalhost, includeChromeMinVersion }) {
  const hostPermissions = [
    'https://www.xiaohongshu.com/*',
    'https://xiaohongshu.com/*',
    'https://app.syntraeai.com/*',
    'https://api.syntraeai.com/*',
  ];
  const contentScriptMatches = ['https://app.syntraeai.com/*'];

  if (includeLocalhost) {
    hostPermissions.push('http://localhost:5173/*', 'http://localhost:3000/*');
    contentScriptMatches.push('http://localhost:5173/*');
  }

  const manifest = {
    name: 'Syntrae XHS Connector',
    short_name: 'Syntrae XHS',
    version: '0.1.0',
    description: 'Captures Xiaohongshu login cookies locally and uploads them to Syntrae for brand-scoped automation.',
    author: 'Syntrae',
    homepage_url: 'https://syntraeai.com',
    permissions: ['cookies', 'tabs'],
    host_permissions: hostPermissions,
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    },
    content_scripts: [
      {
        matches: contentScriptMatches,
        js: ['content-script.js'],
        run_at: 'document_start'
      }
    ],
    action: { default_title: 'Syntrae XHS Connector' }
  };

  if (includeChromeMinVersion) {
    manifest.minimum_chrome_version = '120';
  }

  return manifest;
}

const variants = [
  {
    name: 'chromium',
    includeLocalhost: true,
    includeChromeMinVersion: true,
    manifestExtras: {
      manifest_version: 3,
      background: { service_worker: 'background.js' },
    }
  },
  {
    name: 'firefox',
    includeLocalhost: true,
    includeChromeMinVersion: false,
    manifestExtras: {
      manifest_version: 2,
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'xhs-connector@syntraeai.com',
          strict_min_version: '121.0',
          data_collection_permissions: {
            required: ['authenticationInfo'],
            optional: []
          }
        }
      }
    }
  },
  {
    name: 'store-chromium',
    includeLocalhost: false,
    includeChromeMinVersion: true,
    manifestExtras: {
      manifest_version: 3,
      background: { service_worker: 'background.js' },
    }
  },
  {
    name: 'store-firefox',
    includeLocalhost: false,
    includeChromeMinVersion: false,
    manifestExtras: {
      manifest_version: 2,
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'xhs-connector@syntraeai.com',
          strict_min_version: '121.0',
          data_collection_permissions: {
            required: ['authenticationInfo'],
            optional: []
          }
        }
      }
    }
  }
];

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  if (cleanOnly) return;

  for (const variant of variants) {
    const targetDir = path.join(distDir, variant.name);
    await fs.mkdir(path.join(targetDir, 'icons'), { recursive: true });
    await copyRecursive(srcDir, targetDir);
    await writeManifest(
      targetDir,
      buildCommonManifest({
        includeLocalhost: variant.includeLocalhost,
        includeChromeMinVersion: variant.includeChromeMinVersion,
      }),
      variant.manifestExtras
    );
    await writePlaceholderIcons(path.join(targetDir, 'icons'));
  }
}

async function writeManifest(targetDir, baseManifest, extras) {
  const manifest = {
    ...baseManifest,
    ...extras
  };
  await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

async function copyRecursive(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(toPath, { recursive: true });
      await copyRecursive(fromPath, toPath);
    } else {
      await fs.copyFile(fromPath, toPath);
    }
  }
}

async function writePlaceholderIcons(iconDir) {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn5s1YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(tinyPngBase64, 'base64');
  await Promise.all([
    fs.writeFile(path.join(iconDir, 'icon-16.png'), bytes),
    fs.writeFile(path.join(iconDir, 'icon-32.png'), bytes),
    fs.writeFile(path.join(iconDir, 'icon-48.png'), bytes),
    fs.writeFile(path.join(iconDir, 'icon-128.png'), bytes),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
