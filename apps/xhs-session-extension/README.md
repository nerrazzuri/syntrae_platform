# Syntrae XHS Connector

Minimal Chrome/Chromium extension for the Syntrae XHS connection flow.

## What it does

- listens for `Connect XHS` requests from `app.syntraeai.com`
- opens `xiaohongshu.com` if needed so the user can log in normally or via QR
- waits for required XHS cookies (`a1`, `web_session`)
- uploads the captured cookie set to Syntrae's ingest endpoint using a one-time challenge

## Install locally

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:

```text
apps/xhs-session-extension
```

## Notes

- This extension does not store XHS passwords.
- It only reads the whitelisted Xiaohongshu cookies needed for Syntrae session capture.
- The uploaded session is bound to the workspace/brand challenge created by the Syntrae app.
