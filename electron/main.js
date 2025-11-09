// electron/main.js (UPDATED to work in ESM: defines __dirname via import.meta.url)
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import url from "node:url"; // used for fileURLToPath below
import { spawn } from "node:child_process";

// In ESM modules __dirname / __filename are not defined — create them from import.meta.url
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverProcess = null;
let nextProcess = null;

const isWin = process.platform === "win32";
const isDev = process.env.NODE_ENV === "development" || process.env.ELECTRON_DEV === "true";

/* -------------------- Utilities -------------------- */
function safeLog(...args) {
  try { console.log("[main]", ...args); } catch {}
}

function spawnNodeScript(scriptPath, env = {}) {
  const nodeExec = process.execPath;
  return spawn(nodeExec, [scriptPath], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: false,
  });
}

function spawnNpmScript(args = [], env = {}) {
  const npmCmd = isWin ? "npm.cmd" : "npm";
  return spawn(npmCmd, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: true,
  });
}

function killChildren() {
  try { if (serverProcess && !serverProcess.killed) serverProcess.kill(); } catch (e) { safeLog("kill serverProcess error", e); }
  try { if (nextProcess && !nextProcess.killed) nextProcess.kill(); } catch (e) { safeLog("kill nextProcess error", e); }
}

/* -------------------- Single-instance guard (dev convenience) -------------------- */
if (!app.requestSingleInstanceLock()) {
  safeLog("Another instance is running - quitting this one.");
  app.quit();
}

/* -------------------- Start backend / Next dev -------------------- */
function startApiServer() {
  try {
    const serverPath = path.join(process.cwd(), "server", "index.js");
    serverProcess = spawnNodeScript(serverPath, { NODE_ENV: isDev ? "development" : "production" });
    serverProcess.on("error", (err) => safeLog("[API] spawn error:", err));
    serverProcess.on("exit", (code, sig) => safeLog(`[API] exited code=${code} signal=${sig}`));
  } catch (err) {
    safeLog("[API] start caught:", err);
  }
}

function startNext() {
  try {
    if (isDev) {
      nextProcess = spawnNpmScript(["run", "dev"], { PORT: "3000", NODE_ENV: "development" });
    } else {
      nextProcess = spawnNpmScript(["run", "start"], { PORT: "3000", NODE_ENV: "production" });
    }
    nextProcess.on("error", (err) => safeLog("[Next] spawn error:", err));
    nextProcess.on("exit", (code, sig) => safeLog(`[Next] exited code=${code} signal=${sig}`));
  } catch (err) {
    safeLog("[Next] start caught:", err);
  }
}

/* -------------------- Main window -------------------- */
function resolvePreloadPath() {
  // During development use local file; when packaged use resources path.
  try {
    if (app.isPackaged) {
      // If you bundle with asar, adjust as necessary for your packaging layout.
      return path.join(process.resourcesPath, "app.asar", "electron", "preload.js");
    }
  } catch (e) {
    // ignore
  }
  // Use the derived __dirname (works in ESM)
  return path.join(__dirname, "preload.js");
}

function createMainWindow(loadUrl) {
  const preloadPath = resolvePreloadPath();
  safeLog("Using preload ->", preloadPath);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(loadUrl).catch((e) => safeLog("mainWindow.loadURL error", e));

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  safeLog("app ready, starting services...", { isDev });
  startApiServer();
  startNext();

  const urlToLoad = isDev ? "http://localhost:3000" : "http://localhost:3000";
  createMainWindow(urlToLoad);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(urlToLoad);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killChildren();
    app.quit();
  }
});

app.on("quit", () => {
  killChildren();
});

/* -------------------- PDF Preview helper -------------------- */
function openPdfPreview(tmpPath, parent) {
  const previewWin = new BrowserWindow({
    width: 1000,
    height: 1200,
    parent: parent || null,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const fileUrl = url.pathToFileURL(tmpPath).toString();
  safeLog("Opening PDF preview ->", fileUrl);
  previewWin.loadURL(fileUrl).catch((e) => safeLog("preview load error", e));

  // tidy up temp file when preview closed
  previewWin.on("closed", () => {
    try { fs.unlinkSync(tmpPath); } catch (e) { safeLog("unlink temp pdf failed", e); }
  });

  return previewWin;
}

/* -------------------- IPC handlers -------------------- */
ipcMain.handle("print-html-preview", async (_event, { html = "", pageSize = "A4", landscape = false, delayMs = 350, debug = false } = {}) => {
  try {
    if (!html) throw new Error("No html provided");

    const renderWin = new BrowserWindow({
      width: 1200,
      height: 1600,
      show: !!debug, // show during debug to inspect rendering
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Use encoded URI form - robust and easier to inspect
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    // load and wait for did-finish-load (with a fallback timeout)
    await renderWin.loadURL(dataUrl);

    await new Promise((resolve) => {
      let resolved = false;
      const tid = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          safeLog('[print-html-preview] did-finish-load timeout, continuing');
          resolve();
        }
      }, 4000);

      renderWin.webContents.once('did-finish-load', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(tid);
          resolve();
        }
      });
    });

    // extra delay so fonts/images can settle (configurable)
    await new Promise((r) => setTimeout(r, Number(delayMs) || 350));

    const pdfOptions = {
      marginsType: 1,
      printBackground: true,
      landscape: !!landscape,
      pageSize: pageSize || "A4",
      scaleFactor: 100,
    };

    const buffer = await renderWin.webContents.printToPDF(pdfOptions);

    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `invoice_preview_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, buffer);

    try { renderWin.destroy(); } catch (e) { safeLog("renderWin.destroy", e); }

    openPdfPreview(tmpPath, mainWindow);
    return { ok: true, tmpPath };
  } catch (err) {
    safeLog("print-html-preview error:", err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("print-preview-pdf", async (event, { pageSize = "A4", landscape = false, scaleFactor = 100 } = {}) => {
  try {
    const srcWin = BrowserWindow.fromWebContents(event.sender);
    if (!srcWin) throw new Error("Source window not found");

    const pdfOptions = {
      marginsType: 1,
      printBackground: true,
      landscape: !!landscape,
      pageSize: pageSize || "A4",
      scaleFactor: Number(scaleFactor) || 100,
    };

    const buffer = await srcWin.webContents.printToPDF(pdfOptions);
    const tmpPath = path.join(os.tmpdir(), `invoice_preview_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, buffer);

    openPdfPreview(tmpPath, srcWin);
    return { ok: true, tmpPath };
  } catch (err) {
    safeLog("print-preview-pdf error:", err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("print-to-pdf", async (event, { defaultPath = "document.pdf", pageSize = "A4", landscape = false, scaleFactor = 100 } = {}) => {
  try {
    const srcWin = BrowserWindow.fromWebContents(event.sender);
    if (!srcWin) throw new Error("Source window not found");

    const pdfOptions = {
      marginsType: 1,
      printBackground: true,
      landscape: !!landscape,
      pageSize,
      scaleFactor,
    };

    const buffer = await srcWin.webContents.printToPDF(pdfOptions);
    const { canceled, filePath } = await dialog.showSaveDialog(srcWin, {
      title: "Save PDF",
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, buffer);
    return { canceled: false, filePath };
  } catch (err) {
    safeLog("print-to-pdf error:", err);
    return { canceled: true, error: String(err) };
  }
});

ipcMain.handle("save-pdf-buffer", async (event, { buffer, defaultPath = "document.pdf" } = {}) => {
  try {
    if (!buffer) throw new Error("No buffer provided");

    const data = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer.buffer || buffer);
    const win = BrowserWindow.fromWebContents(event.sender);

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save PDF",
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, data);
    return { canceled: false, filePath };
  } catch (err) {
    safeLog("save-pdf-buffer error:", err);
    return { canceled: true, error: String(err) };
  }
});

/* -------------------- Optional: handle open-external if preload calls it -------------------- */
ipcMain.handle("open-external", async (_event, urlToOpen) => {
  try {
    if (typeof urlToOpen !== "string") throw new Error("invalid url");
    const { shell } = await import("electron");
    await shell.openExternal(urlToOpen);
    return { ok: true };
  } catch (err) {
    safeLog("open-external error", err);
    return { ok: false, error: String(err) };
  }
});

/* -------------------- Safety logging -------------------- */
process.on("unhandledRejection", (reason, promise) => {
  safeLog("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  safeLog("Uncaught Exception:", err);
});
