const browserApi = globalThis.browser || globalThis.chrome;
const XHS_URL = "https://www.xiaohongshu.com/";
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 2 * 60 * 1000;

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SYNTRAE_XHS_CAPTURE_REQUEST") {
    return false;
  }

  handleCaptureRequest(message.payload)
    .then((result) => sendResponse({ success: true, ...result }))
    .catch((error) => sendResponse({ success: false, error: error?.message || "Capture failed" }));

  return true;
});

async function handleCaptureRequest(payload) {
  const requiredCookieNames = Array.isArray(payload?.requiredCookieNames) && payload.requiredCookieNames.length > 0
    ? payload.requiredCookieNames
    : ["a1", "web_session"];

  let cookies = await getRequiredCookies(requiredCookieNames);
  if (cookies.length < requiredCookieNames.length) {
    await browserApi.tabs.create({ url: XHS_URL });
    cookies = await waitForCookies(requiredCookieNames);
  }

  const response = await fetch(payload.ingestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: payload.challengeId,
      nonce: payload.nonce,
      user_agent: navigator.userAgent,
      cookies,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Failed to upload XHS session");
  }

  return { connection: body };
}

async function waitForCookies(requiredCookieNames) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const cookies = await getRequiredCookies(requiredCookieNames);
    if (cookies.length >= requiredCookieNames.length) {
      return cookies;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for XHS login cookies. Please log in on xiaohongshu.com and try again.");
}

async function getRequiredCookies(requiredCookieNames) {
  const allCookies = await browserApi.cookies.getAll({ domain: "xiaohongshu.com" });
  return allCookies
    .filter((cookie) => requiredCookieNames.includes(cookie.name))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: normalizeSameSite(cookie.sameSite),
      expirationDate: cookie.expirationDate ?? null,
    }));
}

function normalizeSameSite(value) {
  switch (String(value || "").toLowerCase()) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    default:
      return "None";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
