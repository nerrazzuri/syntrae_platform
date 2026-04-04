# Extension Submission Guide

Use the store-ready build outputs for browser marketplace submission:

- `apps/xhs-session-extension/dist/store-chromium`
- `apps/xhs-session-extension/dist/store-firefox`

Chrome and Edge use the same Chromium package.

## Build

From the repo root:

```bash
cd apps/xhs-session-extension
node scripts/build.mjs
powershell -ExecutionPolicy Bypass -File scripts/package-store.ps1
```

## What To Upload

- Chrome Web Store: zip the contents of `dist/store-chromium`
- Microsoft Edge Add-ons: zip the contents of `dist/store-chromium`
- Firefox Add-ons: zip the contents of `dist/store-firefox`

The manifest file must remain at the root of the uploaded zip.
The PowerShell packaging script also creates ready-to-upload archives in `dist/packages`.

## Required Store Metadata

- extension name
- short description
- long description
- privacy policy URL
- support email or support URL
- website URL
- store screenshots
- store icon / promotional graphics

## Required Syntrae URLs

- website: `https://syntraeai.com`
- app: `https://app.syntraeai.com`
- privacy policy: `https://syntraeai.com/privacy`
- terms: `https://syntraeai.com/terms`
- support: `support@syntraeai.com`

## Store Readiness Notes

- Chrome Web Store only accepts Manifest V3 extensions. The Chromium store package uses MV3.
- Firefox AMO requires browser-specific settings and data collection declarations for new submissions. The Firefox store package includes a `gecko` ID and `data_collection_permissions`.
- The extension transmits Xiaohongshu authentication cookies to Syntrae only after the user explicitly starts the connection flow from `app.syntraeai.com`.

## Manual Submission Checklist

1. Build the extension packages.
2. Zip the store-ready folder for the target browser.
3. Upload the zip to the browser store dashboard.
4. Add listing screenshots and the privacy policy URL.
5. Submit for review.
6. After approval, configure:

```env
VITE_XHS_EXTENSION_CHROME_URL=
VITE_XHS_EXTENSION_EDGE_URL=
VITE_XHS_EXTENSION_FIREFOX_URL=
```

7. Rebuild `operator-ui` so `Connect XHS` uses the store links instead of manual downloads.
