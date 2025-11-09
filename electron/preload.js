// electron/preload.js (CommonJS-safe version for Electron)
// This exposes window.electronAPI with PDF print/preview helpers.

const { contextBridge, ipcRenderer } = require("electron");

function log(...args) {
  try {
    console.log("[preload]", ...args);
  } catch {}
}

log("preload script running (CommonJS)");

/* -------------------- Helpers -------------------- */
function isPlainSerializable(val) {
  if (val == null) return true;
  const t = typeof val;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (Array.isArray(val)) return val.every(isPlainSerializable);
  if (val instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(val)) return true; // Uint8Array etc.
  if (t === "object") {
    return Object.keys(val).every((k) => isPlainSerializable(val[k]));
  }
  return false;
}

function safeInvoke(channel, payload) {
  if (payload !== undefined && !isPlainSerializable(payload)) {
    log("safeInvoke: rejecting non-serializable payload for channel", channel);
    return Promise.reject(new Error("Payload contains non-serializable values"));
  }
  return ipcRenderer.invoke(channel, payload);
}

/* -------------------- API exposed to renderer -------------------- */
const electronAPI = {
  __isElectron: true,

  // Generate PDF from HTML string and show Chrome-style preview
  printHtmlPreview: async (payload = {}) => {
    log("renderer -> printHtmlPreview", payload);
    return safeInvoke("print-html-preview", payload);
  },

  // Print the sender window to PDF and open preview
  printPreviewPdf: async (payload = {}) => {
    log("renderer -> printPreviewPdf", payload);
    return safeInvoke("print-preview-pdf", payload);
  },

  // Print sender window to PDF and save to disk
  printToPdf: async (payload = {}) => {
    log("renderer -> printToPdf", payload);
    return safeInvoke("print-to-pdf", payload);
  },

  // Save PDF buffer from renderer
  savePdfBuffer: async (payload = {}) => {
    if (payload && payload.buffer && ArrayBuffer.isView(payload.buffer)) {
      payload = { ...payload, buffer: new Uint8Array(payload.buffer.buffer || payload.buffer) };
    }
    log("renderer -> savePdfBuffer", payload && { hasBuffer: !!payload.buffer });
    return safeInvoke("save-pdf-buffer", payload);
  },

  // Open an external link in system browser
  openExternal: async (url) => {
    log("renderer -> openExternal", url);
    if (typeof url !== "string") return Promise.reject(new Error("url must be a string"));
    return safeInvoke("open-external", url);
  },
};

// Expose APIs to renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Optional alias (backward compatibility)
contextBridge.exposeInMainWorld("electronOpenExternal", {
  open: (u) => electronAPI.openExternal(u),
});

log("preload: electronAPI exposed");
