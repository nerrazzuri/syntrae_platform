const browserApi = globalThis.browser || globalThis.chrome;
const XHS_LOGIN_URLS = [
  "https://www.rednote.com/explore",
  "https://www.xiaohongshu.com/explore",
];
const REDNOTE_LOGIN_URL = XHS_LOGIN_URLS[0];
const XIAOHONGSHU_DISCOVERY_URL = XHS_LOGIN_URLS[1];
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 2 * 60 * 1000;
const POST_LOGIN_RELOAD_DELAY_MS = 8000;
const CAPTURE_COOKIE_NAMES = [
  "a1",
  "webId",
  "id_token",
  "web_session",
  "web_session_sec",
  "web_session_sig",
  "websectiga",
  "sec_poison_id",
  "gid",
  "abRequestId",
  "xsecappid",
  "webBuild",
  "loadts",
  "unread",
];
const XHS_COOKIE_DOMAINS = [
  "xiaohongshu.com",
  ".xiaohongshu.com",
  "www.xiaohongshu.com",
  ".www.xiaohongshu.com",
  "rednote.com",
  ".rednote.com",
  "www.rednote.com",
  ".www.rednote.com",
];

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "SYNTRAE_XHS_CLEAR_SESSION_REQUEST") {
    clearCapturedCookies()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error?.message || "Cookie clear failed" }));
    return true;
  }

  if (message.type !== "SYNTRAE_XHS_CAPTURE_REQUEST") {
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
    : ["web_session", "id_token"];

  let cookies = await getCapturedCookies();
  if (!hasRequiredCookies(cookies, requiredCookieNames)) {
    const tab = await browserApi.tabs.create({ url: REDNOTE_LOGIN_URL, active: true });
    scheduleTabReload(tab?.id);
    cookies = await waitForCookies(requiredCookieNames);
  }

  cookies = await ensureDiscoveryCookies(cookies);

  let response;
  try {
    response = await fetch(payload.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: payload.challengeId,
        nonce: payload.nonce,
        user_agent: navigator.userAgent,
        cookies,
      }),
    });
  } catch (error) {
    const base = error?.message || "Failed to fetch";
    throw new Error(`${base}. Could not reach ${payload.ingestUrl}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Failed to upload XHS session");
  }

  return { connection: body };
}

async function waitForCookies(requiredCookieNames) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const cookies = await getCapturedCookies();
    if (hasRequiredCookies(cookies, requiredCookieNames)) {
      return cookies;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const finalCookies = await getCapturedCookies();
  const foundNames = new Set(finalCookies.map((cookie) => cookie.name));
  const missingNames = requiredCookieNames.filter((name) => !foundNames.has(name));
  if (!foundNames.has("a1") && !foundNames.has("id_token")) {
    missingNames.push("a1|id_token");
  }
  throw new Error(`Timed out waiting for XHS login cookies. Missing: ${Array.from(new Set(missingNames)).join(", ")}. Finish login on the Xiaohongshu tab, wait for the page to fully load, then try again.`);
}

async function ensureDiscoveryCookies(cookies) {
  if (hasDiscoveryCookies(cookies)) {
    return cookies;
  }

  const tab = await browserApi.tabs.create({ url: XIAOHONGSHU_DISCOVERY_URL, active: true });
  scheduleTabReload(tab?.id);
  return await waitForDiscoveryCookies();
}

async function waitForDiscoveryCookies() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const cookies = await getCapturedCookies();
    if (hasDiscoveryCookies(cookies)) {
      return cookies;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const finalCookies = await getCapturedCookies();
  const summary = summarizeCookieDomains(finalCookies);
  throw new Error(`Timed out waiting for Xiaohongshu discovery cookies. Open ${XIAOHONGSHU_DISCOVERY_URL}, confirm you are logged in there, wait for the page to fully load, then try again. Captured so far: ${summary}`);
}

async function getCapturedCookies() {
  const cookieSets = await Promise.allSettled([
    browserApi.cookies.getAll({ domain: "xiaohongshu.com" }),
    browserApi.cookies.getAll({ domain: ".xiaohongshu.com" }),
    browserApi.cookies.getAll({ domain: "rednote.com" }),
    browserApi.cookies.getAll({ domain: ".rednote.com" }),
    ...XHS_LOGIN_URLS.map((url) => browserApi.cookies.getAll({ url })),
  ]);

  const allCookies = [];
  for (const result of cookieSets) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      allCookies.push(...result.value);
    }
  }

  allCookies.push(...await getPageSessionCookies());

  return Array.from(new Map(allCookies.map((cookie) => [`${cookie.name}:${cookie.domain}:${cookie.path}`, cookie])).values())
    .filter((cookie) => CAPTURE_COOKIE_NAMES.includes(cookie.name))
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

async function getPageSessionCookies() {
  const tabs = await queryXhsTabs();
  const snapshots = await Promise.allSettled(
    tabs.map((tab) => browserApi.tabs.sendMessage(tab.id, { type: "SYNTRAE_XHS_PAGE_SESSION_SNAPSHOT" }))
  );
  const cookies = [];

  for (const result of snapshots) {
    if (result.status !== "fulfilled" || !result.value?.success) continue;
    const href = result.value.href || "";
    const domain = href.includes("rednote.com") ? ".rednote.com" : ".xiaohongshu.com";
    cookies.push(...parseDocumentCookie(result.value.cookie || "", domain));
    for (const [name, value] of Object.entries(result.value.localSessionValues || {})) {
      if (!CAPTURE_COOKIE_NAMES.includes(name) || !value) continue;
      cookies.push({
        name,
        value: String(value),
        domain,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "no_restriction",
        expirationDate: null,
      });
    }
  }

  return cookies;
}

async function queryXhsTabs() {
  const patterns = [
    "https://www.xiaohongshu.com/*",
    "https://xiaohongshu.com/*",
    "https://www.rednote.com/*",
    "https://rednote.com/*",
  ];
  const results = await Promise.allSettled(patterns.map((url) => browserApi.tabs.query({ url })));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []).filter((tab) => tab?.id);
}

function parseDocumentCookie(cookieString, domain) {
  if (!cookieString) return [];
  return cookieString
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return null;
      const name = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!CAPTURE_COOKIE_NAMES.includes(name) || !value) return null;
      return {
        name,
        value,
        domain,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "no_restriction",
        expirationDate: null,
      };
    })
    .filter(Boolean);
}

async function clearCapturedCookies() {
  const cookies = await getAllXhsCookies();
  const removals = cookies.map((cookie) => removeCookie(cookie));
  const results = await Promise.allSettled(removals);
  const failed = results.filter((result) => result.status === "rejected");

  if (failed.length > 0) {
    throw new Error(`Failed to clear ${failed.length} Xiaohongshu cookie(s)`);
  }

  return { cleared: cookies.length };
}

async function getAllXhsCookies() {
  const cookieSets = await Promise.allSettled([
    ...XHS_COOKIE_DOMAINS.map((domain) => browserApi.cookies.getAll({ domain })),
    ...XHS_LOGIN_URLS.map((url) => browserApi.cookies.getAll({ url })),
  ]);

  const allCookies = [];
  for (const result of cookieSets) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      allCookies.push(...result.value);
    }
  }

  return Array.from(new Map(allCookies.map((cookie) => [`${cookie.name}:${cookie.domain}:${cookie.path}:${cookie.secure}`, cookie])).values());
}

async function removeCookie(cookie) {
  const secure = cookie.secure !== false;
  const host = normalizeCookieHost(cookie.domain);
  const path = cookie.path || "/";
  const url = `${secure ? "https" : "http"}://${host}${path}`;

  return browserApi.cookies.remove({
    url,
    name: cookie.name,
    storeId: cookie.storeId,
  });
}

function normalizeCookieHost(domain) {
  return String(domain || "").replace(/^\./, "") || "www.rednote.com";
}

function hasRequiredCookies(cookies, requiredCookieNames) {
  const names = new Set(cookies.map((cookie) => cookie.name));
  const hasRequiredNames = requiredCookieNames.every((name) => names.has(name));
  const hasAuthCookie = names.has("a1") || names.has("id_token");
  return hasRequiredNames && hasAuthCookie;
}

function hasDiscoveryCookies(cookies) {
  const xiaohongshuCookies = cookies.filter((cookie) => isXiaohongshuDomain(cookie.domain));
  const names = new Set(xiaohongshuCookies.map((cookie) => cookie.name));
  return names.has("a1") && names.has("web_session");
}

function isXiaohongshuDomain(domain) {
  return String(domain || "").replace(/^\./, "").endsWith("xiaohongshu.com");
}

function summarizeCookieDomains(cookies) {
  if (!cookies.length) return "none";
  return Array.from(new Set(cookies.map((cookie) => `${cookie.name}@${cookie.domain || "unknown"}`))).join(", ");
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
