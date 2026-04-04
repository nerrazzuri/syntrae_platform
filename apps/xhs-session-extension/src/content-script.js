(function () {
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

    if (event.data.type !== "SYNTRAE_XHS_CAPTURE_REQUEST") return;

    try {
      const response = await browser.runtime.sendMessage({
        type: "SYNTRAE_XHS_CAPTURE_REQUEST",
        payload: event.data.payload,
      });

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
