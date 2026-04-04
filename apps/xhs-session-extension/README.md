# Syntrae XHS Connector

Installable browser extension packages for the Syntrae XHS connection flow.

## What it does

- listens for `Connect XHS` requests from `app.syntraeai.com`
- opens `xiaohongshu.com` if needed so the user can log in normally or via QR
- waits for required XHS cookies (`a1`, `web_session`)
- uploads the captured cookie set to Syntrae's ingest endpoint using a one-time challenge

## Build packages

From the repo root:

```bash
cd apps/xhs-session-extension
node scripts/build.mjs
```

This generates:

```text
apps/xhs-session-extension/dist/chromium
apps/xhs-session-extension/dist/firefox
apps/xhs-session-extension/dist/store-chromium
apps/xhs-session-extension/dist/store-firefox
```

Use `dist/chromium` for:
- Chrome
- Edge

Use `dist/firefox` for:
- Firefox

Use `dist/store-chromium` and `dist/store-firefox` for browser-store submission.

## Install locally

### Chrome / Edge

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select:

```text
apps/xhs-session-extension/dist/chromium
```

### Firefox

1. Open `about:debugging`
2. Click `This Firefox`
3. Click `Load Temporary Add-on`
4. Select:

```text
apps/xhs-session-extension/dist/firefox/manifest.json
```

## Notes

- This extension does not store XHS passwords.
- It only reads the whitelisted Xiaohongshu cookies needed for Syntrae session capture.
- The uploaded session is bound to the workspace/brand challenge created by the Syntrae app.
- Browser-store submission steps are documented in `SUBMISSION.md`.
