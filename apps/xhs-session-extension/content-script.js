(function () {
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "SYNTRAE_XHS_CAPTURE_REQUEST") return;

    try {
      const response = await chrome.runtime.sendMessage({
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
