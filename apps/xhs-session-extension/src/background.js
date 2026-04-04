const browserApi = globalThis.browser || globalThis.chrome;
const XHS_URL = "https://www.xiaohongshu.com/";
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 2 * 60 * 1000;
const POST_LOGIN_RELOAD_DELAY_MS = 8000;

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
    const tab = await browserApi.tabs.create({ url: XHS_URL, active: true });
    scheduleTabReload(tab?.id);
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

  const finalCookies = await getRequiredCookies(requiredCookieNames);
  const foundNames = new Set(finalCookies.map((cookie) => cookie.name));
  const missingNames = requiredCookieNames.filter((name) => !foundNames.has(name));
  throw new Error(`Timed out waiting for XHS login cookies. Missing: ${missingNames.join(", ")}. Finish login on the Xiaohongshu tab, wait for the page to fully load, then try again.`);
}

async function getRequiredCookies(requiredCookieNames) {
  const cookieSets = await Promise.allSettled([
    browserApi.cookies.getAll({ domain: "xiaohongshu.com" }),
    browserApi.cookies.getAll({ domain: ".xiaohongshu.com" }),
    browserApi.cookies.getAll({ url: XHS_URL }),
  ]);

  const allCookies = [];
  for (const result of cookieSets) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      allCookies.push(...result.value);
    }
  }

  return Array.from(new Map(allCookies.map((cookie) => [`${cookie.name}:${cookie.domain}:${cookie.path}`, cookie])).values())
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

function scheduleTabReload(tabId) {
  if (!tabId || !browserApi.tabs?.reload) return;
  setTimeout(() => {
    browserApi.tabs.reload(tabId).catch(() => {});
  }, POST_LOGIN_RELOAD_DELAY_MS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
