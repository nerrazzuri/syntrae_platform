(function () {
  const runtimeApi = globalThis.browser?.runtime || globalThis.chrome?.runtime;

  async function dispatchRuntimeRequest(type, payload) {
    if (!runtimeApi?.sendMessage) {
      throw new Error("Extension runtime API unavailable");
    }

    return await runtimeApi.sendMessage({ type, payload });
  }

  function readLocalSessionValues() {
    const values = {};
    const names = [
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
    ];

    for (const name of names) {
      try {
        const value = window.localStorage?.getItem(name) || window.sessionStorage?.getItem(name);
        if (value) values[name] = value;
      } catch {
        // Storage may be blocked on some pages; cookie API fallback still applies.
      }
    }

    return values;
  }

  runtimeApi?.onMessage?.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "SYNTRAE_XHS_PAGE_SESSION_SNAPSHOT") {
      return false;
    }

    sendResponse({
      success: true,
      href: window.location.href,
      cookie: document.cookie || "",
      localSessionValues: readLocalSessionValues(),
    });
    return false;
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === "SYNTRAE_XHS_EXTENSION_PING") {
      window.dispatchEvent(new CustomEvent("SYNTRAE_XHS_EXTENSION_PONG", {
        detail: {
          installed: true,
          version: "0.1.0"
        },
      }));
      return;
    }

    if (event.data.type === "SYNTRAE_XHS_CLEAR_SESSION_REQUEST") {
      try {
        const response = await dispatchRuntimeRequest("SYNTRAE_XHS_CLEAR_SESSION_REQUEST", event.data.payload);
        window.dispatchEvent(new CustomEvent("SYNTRAE_XHS_CLEAR_SESSION_RESULT", {
          detail: response || { success: false, error: "No response from extension" },
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("SYNTRAE_XHS_CLEAR_SESSION_RESULT", {
          detail: { success: false, error: error?.message || "Extension request failed" },
        }));
      }
      return;
    }

    if (event.data.type !== "SYNTRAE_XHS_CAPTURE_REQUEST") return;

    try {
      const response = await dispatchRuntimeRequest("SYNTRAE_XHS_CAPTURE_REQUEST", event.data.payload);

      window.dispatchEvent(new CustomEvent("SYNTRAE_XHS_CAPTURE_RESULT", {
        detail: response || { success: false, error: "No response from extension" },
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("SYNTRAE_XHS_CAPTURE_RESULT", {
        detail: { success: false, error: error?.message || "Extension request failed" },
      }));
    }
  });
})();
