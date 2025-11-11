// electron/main.js (ESM) — updated: robust startApiServer + startNext (dev & prod) + tuned print handlers
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import url from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverProcess = null;
let nextProcess = null;

const isWin = process.platform === "win32";
const isDev =
  process.env.NODE_ENV === "development" || process.env.ELECTRON_DEV === "true";
const API_PORT = Number(process.env.API_PORT || 3001);
const NEXT_PORT = Number(process.env.NEXT_PORT || 3000);

/* ---------- logging helpers ---------- */
function safeLog(...args) {
  try {
    console.log("[main]", ...args);
  } catch {}
}
function userDataLogPath() {
  const p = path.join(app.getPath("userData"), "server.log");
  return p;
}
function appendLog(chunk) {
  try {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    fs.appendFileSync(userDataLogPath(), text + "\n");
  } catch (e) {
    safeLog("appendLog failed", e && e.message ? e.message : e);
  }
}

/* ---------- spawn helpers ---------- */
function spawnDetached(cmd, args = [], opts = {}) {
  const finalOpts = {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  };
  try {
    const child = spawn(cmd, args, finalOpts);

    // log stdout/stderr (if pipes present)
    if (child.stdout)
      child.stdout.on("data", (d) =>
        appendLog(
          `[${path.basename(
            String(cmd)
          )} stdout ${new Date().toISOString()}] ${d.toString()}`
        )
      );
    if (child.stderr)
      child.stderr.on("data", (d) =>
        appendLog(
          `[${path.basename(
            String(cmd)
          )} stderr ${new Date().toISOString()}] ${d.toString()}`
        )
      );

    // error and exit handlers
    child.on("error", (err) =>
      appendLog(
        `[${path.basename(String(cmd))} error ${new Date().toISOString()}] ${
          err && err.stack ? err.stack : String(err)
        }`
      )
    );
    child.on("exit", (code, sig) =>
      appendLog(
        `[${path.basename(
          String(cmd)
        )} exit ${new Date().toISOString()}] code=${code} sig=${sig}`
      )
    );

    // detach if supported
    try {
      child.unref?.();
    } catch {}
    return child;
  } catch (err) {
    appendLog(
      `[spawnDetached] error: ${err && err.stack ? err.stack : String(err)}`
    );
    return null;
  }
}

/* ---------- debug spawn helper (use while diagnosing) ---------- */
function spawnDebug(cmd, args = [], opts = {}) {
  const finalOpts = {
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  };
  try {
    const child = spawn(cmd, args, finalOpts);
    if (child.stdout)
      child.stdout.on("data", (d) =>
        appendLog(
          `[${path.basename(
            String(cmd)
          )} stdout ${new Date().toISOString()}] ${d.toString()}`
        )
      );
    if (child.stderr)
      child.stderr.on("data", (d) =>
        appendLog(
          `[${path.basename(
            String(cmd)
          )} stderr ${new Date().toISOString()}] ${d.toString()}`
        )
      );
    child.on("error", (err) =>
      appendLog(
        `[${path.basename(String(cmd))} error ${new Date().toISOString()}] ${
          err && err.stack ? err.stack : String(err)
        }`
      )
    );
    child.on("exit", (code, sig) =>
      appendLog(
        `[${path.basename(
          String(cmd)
        )} exit ${new Date().toISOString()}] code=${code} sig=${sig}`
      )
    );
    return child;
  } catch (err) {
    appendLog(
      `[spawnDebug] error: ${err && err.stack ? err.stack : String(err)}`
    );
    return null;
  }
}

/* ---------- lifecycle helpers ---------- */
function killChildren() {
  try {
    if (serverProcess && !serverProcess.killed) serverProcess.kill();
  } catch (e) {
    safeLog("kill serverProcess error", e);
  }
  try {
    if (nextProcess && !nextProcess.killed) nextProcess.kill();
  } catch (e) {
    safeLog("kill nextProcess error", e);
  }
}

/* ---------- single-instance ---------- */
if (!app.requestSingleInstanceLock()) {
  safeLog("Another instance is running - quitting this one.");
  app.quit();
}

/* ---------- helper: candidate server paths (exe + JS) ---------- */
function candidateServerExecutables() {
  const cand = [];

  if (process.resourcesPath) {
    // packaged/extracted server exe candidates
    cand.push(path.join(process.resourcesPath, "server", "server.exe"));
    cand.push(path.join(process.resourcesPath, "server", "server"));
    cand.push(path.join(process.resourcesPath, "server.exe"));
    cand.push(path.join(process.resourcesPath, "server"));
    cand.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "server",
        "server.exe"
      )
    );
    cand.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "server", "server")
    );

    // optional bundled node binary inside resources/server/
    cand.push(path.join(process.resourcesPath, "server", "node.exe"));
    cand.push(path.join(process.resourcesPath, "server", "node"));
    cand.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "server",
        "node.exe"
      )
    );
    cand.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "server", "node")
    );
  }

  // fallback relative to build output
  cand.push(path.join(__dirname, "..", "resources", "server", "server.exe"));
  cand.push(path.join(__dirname, "..", "resources", "server", "server"));
  cand.push(path.join(__dirname, "..", "resources", "server", "node.exe"));
  cand.push(path.join(__dirname, "..", "resources", "server", "node"));

  return cand;
}

function candidateServerScripts() {
  const cand = [];
  cand.push(path.join(process.cwd(), "server", "index.js"));
  cand.push(path.join(__dirname, "..", "server", "index.js"));
  cand.push(path.join(__dirname, "server", "index.js"));
  if (process.resourcesPath) {
    cand.push(path.join(process.resourcesPath, "server", "index.js"));
    cand.push(path.join(process.resourcesPath, "app", "server", "index.js"));
    cand.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "server",
        "index.js"
      )
    );
    cand.push(path.join(process.resourcesPath, "server", "index.js"));
  }
  cand.push(path.join(process.cwd(), "server.js"));
  cand.push(path.join(__dirname, "..", "server.js"));
  return cand;
}

/* ---------- debug listing for candidates ---------- */
function listCandidatesForDebug() {
  const exes = candidateServerExecutables();
  const scripts = candidateServerScripts();
  appendLog(`[main] exeCandidates:\n${exes.join("\n")}`);
  appendLog(`[main] scriptCandidates:\n${scripts.join("\n")}`);
}

/* ---------- improved findNodeCmd ---------- */
function findNodeCmd() {
  // prefer a bundled node in resources/server, then system 'node'
  const possibleBundled = [];
  if (process.resourcesPath) {
    possibleBundled.push(
      path.join(process.resourcesPath, "server", "node.exe")
    );
    possibleBundled.push(path.join(process.resourcesPath, "server", "node"));
    possibleBundled.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "server",
        "node.exe"
      )
    );
    possibleBundled.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "server", "node")
    );
  }
  possibleBundled.push(
    path.join(__dirname, "..", "resources", "server", "node.exe")
  );
  possibleBundled.push(
    path.join(__dirname, "..", "resources", "server", "node")
  );

  const bundledFound = possibleBundled.find((p) => {
    try {
      return p && fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (bundledFound) {
    appendLog(`[main] findNodeCmd -> using bundled node at ${bundledFound}`);
    return bundledFound;
  }

  // avoid using Electron binary as node. Only return process.execPath if it looks like 'node' binary.
  try {
    const execBase = path.basename(process.execPath).toLowerCase();
    if (execBase.startsWith("node") || execBase.includes("node.exe")) {
      appendLog(
        `[main] findNodeCmd -> using process.execPath (${process.execPath}) as node`
      );
      return process.execPath;
    }
  } catch (e) {
    /* ignore */
  }

  // fallback to system 'node' available in PATH
  appendLog(`[main] findNodeCmd -> falling back to system 'node'`);
  return "node";
}

/* ---------- start server (tries resources script first, then exe, then script candidates) ---------- */
function startApiServer() {
  if (serverProcess) return;

  try {
    listCandidatesForDebug();

    // 1) Prefer explicit resources/server/index.js (most reliable)
    const resourceScript = process.resourcesPath
      ? path.join(process.resourcesPath, "server", "index.js")
      : null;
    if (
      resourceScript &&
      fs.existsSync(resourceScript) &&
      fs.statSync(resourceScript).isFile()
    ) {
      appendLog(`[main] Found resources server script: ${resourceScript}`);
      const nodeCmd = findNodeCmd();
      // switched to spawnDetached for production detached behavior
      serverProcess = spawnDetached(nodeCmd, [resourceScript], {
        cwd: path.dirname(resourceScript),
        env: {
          ...process.env,
          NODE_ENV: isDev ? "development" : "production",
          PORT: String(API_PORT),
        },
        shell: false,
      });
      if (serverProcess) return;
      appendLog(
        `[main] spawnDetached failed for ${nodeCmd} ${resourceScript}, continuing to other candidates`
      );
    }

    // 2) Try packaged native executable first (pkg-built server.exe)
    const exeCandidates = candidateServerExecutables();
    const exeFound = exeCandidates.find((p) => {
      try {
        return p && fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (exeFound) {
      appendLog(`[main] Starting packaged server executable: ${exeFound}`);
      serverProcess = spawnDetached(exeFound, [], {
        cwd: path.dirname(exeFound),
      });
      return;
    }

    // 3) Try other script candidates (fallback)
    const scriptCandidates = candidateServerScripts();
    const scriptPath = scriptCandidates.find((p) => {
      try {
        return p && fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });

    if (scriptPath) {
      appendLog(`[main] Starting server JS script: ${scriptPath}`);
      const nodeCmdCandidate = findNodeCmd();
      try {
        serverProcess = spawnDetached(nodeCmdCandidate, [scriptPath], {
          cwd: path.dirname(scriptPath),
          env: {
            ...process.env,
            NODE_ENV: isDev ? "development" : "production",
            PORT: String(API_PORT),
          },
        });
        if (!serverProcess)
          appendLog(
            `[main] spawnDetached returned null when trying to spawn ${nodeCmdCandidate}`
          );
      } catch (err) {
        appendLog(
          `[main] spawn error for script ${scriptPath}: ${
            err && err.stack ? err.stack : String(err)
          }`
        );
      }
      return;
    }

    // 4) Directory candidates check (same as before)
    const dirCandidates = (
      process.resourcesPath
        ? [
            path.join(process.resourcesPath, "server"),
            path.join(process.resourcesPath, "app", "server"),
          ]
        : []
    ).concat([
      path.join(__dirname, "..", "server"),
      path.join(process.cwd(), "server"),
    ]);
    for (const d of dirCandidates) {
      try {
        if (d && fs.existsSync(d) && fs.statSync(d).isDirectory()) {
          const idx = path.join(d, "index.js");
          if (fs.existsSync(idx) && fs.statSync(idx).isFile()) {
            appendLog(`[main] Found script inside directory candidate: ${idx}`);
            const nodeCmd = findNodeCmd();
            serverProcess = spawnDetached(nodeCmd, [idx], {
              cwd: d,
              env: {
                ...process.env,
                NODE_ENV: isDev ? "development" : "production",
                PORT: String(API_PORT),
              },
            });
            return;
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    appendLog(
      `[main] No server executable or script found. Tried executables:\n${exeCandidates.join(
        "\n"
      )}\nScripts:\n${scriptCandidates.join(
        "\n"
      )}\nDir candidates:\n${dirCandidates.join("\n")}`
    );
  } catch (err) {
    appendLog(
      `[main] startApiServer error: ${
        err && err.stack ? err.stack : String(err)
      }`
    );
  }
}

/* ---------- start Next (dev + prod) ---------- */
function startNext() {
  if (nextProcess) return;

  try {
    const npmCmd = isWin ? "npm.cmd" : "npm";

    if (isDev) {
      // pick app root sensibly: prefer project root next to electron/ when launching dev
      const candidateRoot = (() => {
        try {
          const maybeRoot = path.resolve(__dirname, ".."); // usually project root
          if (fs.existsSync(path.join(maybeRoot, "package.json")))
            return maybeRoot;
        } catch {}
        try {
          if (fs.existsSync(path.join(process.cwd(), "package.json")))
            return process.cwd();
        } catch {}
        return process.cwd();
      })();

      appendLog(
        `[main] Starting next dev (npm run dev) on port ${NEXT_PORT} (cwd=${candidateRoot})`
      );
      nextProcess = spawnDetached(npmCmd, ["run", "dev"], {
        cwd: candidateRoot,
        env: {
          ...process.env,
          PORT: String(NEXT_PORT),
          NODE_ENV: "development",
        },
        shell: true,
      });
      return;
    }

    // Production: try to run next in a robust way
    appendLog(`[main] Starting next production server on port ${NEXT_PORT}`);

    // 1) Prefer .next/standalone server.js if present (recommended output from next build when using 'standalone')
    const prodCandidates = [
      path.join(process.resourcesPath || "", "app.asar.unpacked"),
      path.join(process.resourcesPath || "", "app"),
      path.join(__dirname, ".."),
      process.cwd(),
    ].filter(Boolean);

    let standaloneServer = null;
    for (const base of prodCandidates) {
      try {
        const s1 = path.join(base, ".next", "standalone", "server.js");
        const s2 = path.join(base, ".next", "standalone", "app.js");
        if (fs.existsSync(s1)) {
          standaloneServer = s1;
          break;
        }
        if (fs.existsSync(s2)) {
          standaloneServer = s2;
          break;
        }
      } catch {}
    }

    if (standaloneServer) {
      appendLog(
        `[main] Found Next standalone server at ${standaloneServer}. Launching with node.`
      );
      const nodeCmd = isWin ? "node.exe" : "node";
      nextProcess = spawnDetached(
        nodeCmd,
        [standaloneServer],
        {
          cwd: path.dirname(standaloneServer),
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(NEXT_PORT),
          },
        }
      );
      return;
    }

    // 2) Try to find next's bin script inside node_modules/next
    let nextBin = null;
    for (const base of prodCandidates) {
      try {
        const tryPath = path.join(
          base,
          "node_modules",
          "next",
          "dist",
          "bin",
          "next.js"
        );
        if (fs.existsSync(tryPath)) {
          nextBin = tryPath;
          break;
        }
      } catch {}
    }

    if (nextBin) {
      appendLog(
        `[main] Found next binary at ${nextBin}. Running "node ${nextBin} start -p ${NEXT_PORT}"`
      );
      const nodeCmd = isWin ? "node.exe" : "node";
      nextProcess = spawnDetached(
        nodeCmd,
        [nextBin, "start", "-p", String(NEXT_PORT)],
        {
          cwd: path.dirname(nextBin),
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(NEXT_PORT),
          },
        }
      );
      return;
    }

    // 3) Fallback: run `npm run start` from the most plausible cwd (process.resourcesPath / __dirname/.. / cwd)
    const chosenCwd =
      prodCandidates.find((d) => {
        try {
          return (
            d &&
            (fs.existsSync(path.join(d, ".next")) ||
              fs.existsSync(path.join(d, "package.json")))
          );
        } catch {
          return false;
        }
      }) || process.cwd();

    appendLog(
      `[main] next prod fallback — running "npm run start" in ${chosenCwd}`
    );
    nextProcess = spawnDetached(npmCmd, ["run", "start"], {
      cwd: chosenCwd,
      env: { ...process.env, PORT: String(NEXT_PORT), NODE_ENV: "production" },
      shell: true,
    });
  } catch (err) {
    appendLog(
      `[main] startNext error: ${err && err.stack ? err.stack : String(err)}`
    );
  }
}

/* ---------- generic HTTP readiness poll ---------- */
function waitForHttpReady({
  host = "127.0.0.1",
  port = 3000,
  path = "/",
  timeoutMs = 15000,
  interval = 300,
} = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      const req = http.request(
        { method: "GET", host, port, path, timeout: 2000 },
        (res) => {
          res.resume();
          appendLog(
            `[main] ${host}:${port}${path} responded ${res.statusCode}`
          );
          resolve(true);
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          appendLog(
            `[main] waitForHttpReady timed out for ${host}:${port}${path}`
          );
          resolve(false);
        } else {
          setTimeout(poll, interval);
        }
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, interval);
      });
      req.end();
    })();
  });
}

/* ---------- window creation ---------- */
function resolvePreloadPath() {
  try {
    if (app.isPackaged) {
      const p2 = path.join(process.resourcesPath, "electron", "preload.js");
      const p1 = path.join(
        process.resourcesPath,
        "app.asar",
        "electron",
        "preload.js"
      );
      const p3 = path.join(__dirname, "preload.js");
      if (fs.existsSync(p2)) return p2;
      if (fs.existsSync(p1)) return p1;
      return p3;
    }
  } catch (e) {}
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
  // place after `const win = new BrowserWindow({...})` and BEFORE win.loadURL(loadUrl)
  try {
    const ses = win.webContents.session;

    // helper to resolve a local file:// URL for a requested /_next/... path
    const localNextRedirect = (originalUrl) => {
      try {
        // originalUrl examples:
        //  http://localhost:3000/_next/static/css/xxxxx.css
        //  http://localhost:3000/_next/webpack/chunk.js
        //  file:///.../_next/static/...
        const u = new URL(originalUrl);
        // We're only mapping requests whose pathname starts with /_next/
        const pathname = u.pathname || "";
        if (!pathname.startsWith("/_next/")) return null;

        // Path to your packaged resources: adjust if your .next ends up elsewhere.
        // Common places: process.resourcesPath + '/.next' OR process.resourcesPath + '/app/.next'
        const candidates = [
          path.join(process.resourcesPath || "", ".next"),
          path.join(process.resourcesPath || "", "app", ".next"),
          path.join(__dirname, "..", ".next"),
          path.join(__dirname, "..", "app", ".next"),
        ];
        // pick first candidate that exists
        let baseNext = candidates.find((p) => {
          try {
            return fs.existsSync(p) && fs.statSync(p).isDirectory();
          } catch {
            return false;
          }
        });
        if (!baseNext) {
          // fallback to process.resourcesPath/_next (some packaging copies .next/_next)
          baseNext = path.join(process.resourcesPath || "", "_next");
        }

        // remove leading /_next/ and join to baseNext
        const rel = pathname.replace(/^\/_next\//, "");
        const localPath = path.join(baseNext, rel);

        if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
          // build file:// URL
          return url.pathToFileURL(localPath).toString();
        }
        return null;
      } catch (e) {
        return null;
      }
    };

    // Register a webRequest redirect for any requests that include "/_next/"
    ses.webRequest.onBeforeRequest(
      { urls: ["*://*/*/_next/*", "*://*/*/_next/*"] },
      (details, callback) => {
        try {
          const redirect = localNextRedirect(details.url);
          if (redirect) {
            // redirect the network request to a local file:// url
            return callback({ redirectURL: redirect });
          }
        } catch (e) {
          // ignore and allow original request
        }
        return callback({}); // no redirect
      }
    );

    // If you want, log intercepted requests (helpful for debugging)
    // ses.webRequest.onBeforeRequest({ urls: ["*://*/*/_next/*"] }, (d, cb) => { appendLog(`[webRequest] ${d.url}`); cb({}); });
  } catch (err) {
    safeLog(
      "webRequest redirect setup failed",
      err && err.message ? err.message : err
    );
  }

  // load the URL (dev: http://localhost:3000, prod: file://... or local next server)
  win.loadURL(loadUrl).catch((e) => safeLog("mainWindow.loadURL error", e));

  // IMPORTANT: ensure relative resolution for / and localhost links in packaged app
  // This handler injects <base href="./"> and rewrites any lingering localhost:/.../_next/... or leading /_next/ to ./_next/
  win.webContents.on("dom-ready", () => {
    try {
      win.webContents
        .executeJavaScript(
          `
        (function() {
          try {
            // 1) Inject base tag so absolute /... resolves relative to the file context
            if (!document.querySelector('base')) {
              const base = document.createElement('base');
              base.href = './';
              document.head.prepend(base);
            }

            // 2) Rewrite stylesheet/script tags that reference the dev server or absolute /_next paths.
            //    Convert:
            //      http://localhost:3000/_next/...  -> ./_next/...
            //      /_next/...                        -> ./_next/...
            //    Works for any localhost port.
            const rewrite = (url) => {
              if (!url) return url;
              // replace http(s)://localhost:PORT/_next/...  -> ./_next/...
              const localhostPattern = /^https?:\\/\\/localhost:\\d+\\/_next\\//;
              if (localhostPattern.test(url)) return url.replace(localhostPattern, './_next/');
              // replace leading /_next/... -> ./_next/...
              const absNext = /^\\/_next\\//;
              if (absNext.test(url)) return url.replace(absNext, './_next/');
              return url;
            };

            Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach(l => {
              try { 
                const newHref = rewrite(l.getAttribute('href'));
                if (newHref && newHref !== l.href) l.setAttribute('href', newHref);
              } catch(e) {}
            });

            Array.from(document.querySelectorAll('script[src]')).forEach(s => {
              try {
                const newSrc = rewrite(s.getAttribute('src'));
                if (newSrc && newSrc !== s.src) s.setAttribute('src', newSrc);
              } catch(e) {}
            });

            // 3) As a fallback, update any DOM <link> or <script> elements added later via JS
            const mo = new MutationObserver(muts => {
              for (const m of muts) {
                for (const n of Array.from(m.addedNodes || [])) {
                  if (n && n.nodeType === 1) {
                    try {
                      if (n.tagName === 'LINK' && n.rel === 'stylesheet') {
                        const newHref = rewrite(n.getAttribute('href'));
                        if (newHref) n.setAttribute('href', newHref);
                      }
                      if (n.tagName === 'SCRIPT' && n.src) {
                        const newSrc = rewrite(n.getAttribute('src'));
                        if (newSrc) n.setAttribute('src', newSrc);
                      }
                    } catch(e) {}
                  }
                }
              }
            });
            mo.observe(document.documentElement || document, { childList: true, subtree: true });

          } catch (inner) { /* ignore page-side errors */ }
        })();
      `
        )
        .catch(() => {});
    } catch (e) {
      safeLog("dom-ready injection failed", e && e.message ? e.message : e);
    }
  });

  if (isDev) win.webContents.openDevTools({ mode: "detach" });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

/* ---------- app ready ---------- */
app.whenReady().then(async () => {
  appendLog(`[main] app ready. isDev=${isDev} isPackaged=${app.isPackaged}`);
  try {
    fs.mkdirSync(path.dirname(userDataLogPath()), { recursive: true });
  } catch {}
  appendLog(`[main] server.log path: ${userDataLogPath()}`);

  // start backend and frontend (dev or prod)
  startApiServer();
  startNext();

  // wait for API
  const apiReady = await waitForHttpReady({
    host: "127.0.0.1",
    port: API_PORT,
    path: "/api/health",
    timeoutMs: isDev ? 8000 : 15000,
    interval: 300,
  });
  if (!apiReady)
    appendLog(
      "[main] API did not report ready (or health check requires auth)."
    );

  // wait for Next (root or _next/static)
  let nextReady = await waitForHttpReady({
    host: "127.0.0.1",
    port: NEXT_PORT,
    path: "/",
    timeoutMs: isDev ? 15000 : 20000,
    interval: 300,
  });
  if (!nextReady) {
    nextReady = await waitForHttpReady({
      host: "127.0.0.1",
      port: NEXT_PORT,
      path: "/_next/static/",
      timeoutMs: 2000,
      interval: 300,
    });
  }
  if (!nextReady) {
    appendLog(
      `[main] Next frontend did not report ready; continuing to load UI (you may see white screen until the frontend becomes ready).`
    );
  } else {
    appendLog(`[main] Next frontend ready, proceeding to load UI`);
  }

  const urlToLoad = `http://localhost:${NEXT_PORT}`;
  createMainWindow(urlToLoad);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(urlToLoad);
  });
});

/* ---------- exit handling ---------- */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killChildren();
    app.quit();
  }
});
app.on("quit", () => {
  killChildren();
});

/* ---------------------------
   PDF preview helper
   --------------------------- */
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

  previewWin.on("closed", () => {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      safeLog("unlink temp pdf failed", e);
    }
  });

  return previewWin;
}

/* -------------------- IPC handlers -------------------- */

/**
 * print-html-preview: tuned per request
 * - larger bill-to (.bb-bill-to)
 * - smaller date (.bb-date)
 * - reduced page margins and invoice padding
 */
ipcMain.handle(
  "print-html-preview",
  async (
    _event,
    {
      html = "",
      pageSize = "A4",
      landscape = false,
      delayMs = 350,
      debug = false,
      headerFontSize = "18px",
      companyFontSize = "24px",
      bodyFontSize = "12px",
      compactTable = true,
      useGoogleFont = true,
      googleFontFamily = "Inter",
    } = {}
  ) => {
    try {
      if (!html) throw new Error("No html provided");

      const renderWin = new BrowserWindow({
        width: 1200,
        height: 1600,
        show: !!debug,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // CSS tuned: bigger bill-to, smaller date, smaller margins
      const printCss = `
      ${
        useGoogleFont
          ? `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(
              googleFontFamily
            )}:wght@300;400;600;700&display=swap');`
          : ""
      }

      :root{
        --company-size: ${companyFontSize};
        --header-size: ${headerFontSize};
        --body-size: ${bodyFontSize};
        --line-height: 1.18;
        --table-padding: ${compactTable ? "6px" : "10px"};
        --invoice-padding-vertical: 10px;
        --invoice-padding-horizontal: 12px;
      }

      html,body{
        margin:0;
        padding:0;
        font-family: ${
          useGoogleFont
            ? `'${googleFontFamily}', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial`
            : `system-ui, -apple-system, "Segoe UI", Roboto, Arial`
        };
        font-size: var(--body-size);
        line-height: var(--line-height);
        color:#111;
      }

      .bb-invoice {
        padding: var(--invoice-padding-vertical) var(--invoice-padding-horizontal);
        box-sizing: border-box;
        width: 100%;
      }

      .bb-company {
        font-weight:700;
        font-size: var(--company-size);
        letter-spacing: 0.4px;
      }
      .bb-invoice-title {
        font-size: var(--header-size);
        font-weight:700;
        margin-top: 4px;
        margin-bottom: 6px;
      }

      .bb-meta {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        margin-top: 6px;
        margin-bottom: 8px;
        font-size: calc(var(--body-size) - 1px);
      }
      .bb-meta .bb-date {
        font-size: calc(var(--body-size) - 3px);
        color: #333;
      }
      .bb-meta .bb-invoice-no {
        font-weight:600;
        font-size: calc(var(--body-size) - 0px);
      }

      .bb-bill-to {
        margin-top: 8px;
        margin-bottom: 12px;
        font-size: calc(var(--body-size) + 2px);
        font-weight:700;
        line-height: 1.16;
      }
      .bb-bill-to .small { font-weight:400; font-size: calc(var(--body-size) - 1px); }

      table.bb-lines {
        width:100%;
        border-collapse: collapse;
        margin-top: 8px;
        font-size: var(--body-size);
      }
      table.bb-lines th, table.bb-lines td {
        padding: var(--table-padding);
        border: 1px solid #e6e6e6;
        text-align: left;
        vertical-align: middle;
      }
      table.bb-lines th {
        background: #fafafa;
        font-weight:600;
      }

      .bb-total-row td {
        border-top: 2px solid #111;
        font-weight:700;
      }
      .bb-grand-total {
        font-size: calc(var(--body-size) + 2px);
        font-weight: 800;
        text-align: right;
      }

      .terms { margin-top: 12px; font-size: calc(var(--body-size) - 1px); color:#333; }
      .page-break { page-break-after: always; }

      /* reduced margins */
      @page { margin: 10mm; }

      @media print {
        html,body { -webkit-print-color-adjust: exact; }
      }

      @media (max-width: 800px) {
        .bb-invoice { padding: 8px; }
        .bb-bill-to { font-size: calc(var(--body-size) + 1px); }
      }
    `;

      const wrappedHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <style>${printCss}</style>
        </head>
        <body>
          <div class="bb-invoice">
            ${html}
          </div>
        </body>
      </html>
    `;

      await renderWin.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(wrappedHtml)}`
      );

      await new Promise((resolve) => {
        let resolved = false;
        const tid = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, 3000 + (Number(delayMs) || 350));

        renderWin.webContents.once("did-finish-load", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(tid);
            resolve();
          }
        });
      });

      await new Promise((r) => setTimeout(r, 200));

      const pdfOptions = {
        marginsType: 0,
        printBackground: true,
        landscape: !!landscape,
        pageSize: pageSize || "A4",
        scaleFactor: 100,
      };

      const buffer = await renderWin.webContents.printToPDF(pdfOptions);

      const tmpDir = os.tmpdir();
      const tmpPath = path.join(tmpDir, `invoice_preview_${Date.now()}.pdf`);
      fs.writeFileSync(tmpPath, buffer);

      try {
        renderWin.destroy();
      } catch (e) {
        safeLog("renderWin.destroy", e);
      }

      openPdfPreview(tmpPath, mainWindow);
      return { ok: true, tmpPath };
    } catch (err) {
      safeLog("print-html-preview error:", err);
      return { ok: false, error: String(err) };
    }
  }
);

ipcMain.handle(
  "print-preview-pdf",
  async (
    event,
    { pageSize = "A4", landscape = false, scaleFactor = 100 } = {}
  ) => {
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
      const tmpPath = path.join(
        os.tmpdir(),
        `invoice_preview_${Date.now()}.pdf`
      );
      fs.writeFileSync(tmpPath, buffer);

      openPdfPreview(tmpPath, srcWin);
      return { ok: true, tmpPath };
    } catch (err) {
      safeLog("print-preview-pdf error:", err);
      return { ok: false, error: String(err) };
    }
  }
);

ipcMain.handle(
  "print-to-pdf",
  async (
    event,
    {
      defaultPath = "document.pdf",
      pageSize = "A4",
      landscape = false,
      scaleFactor = 100,
    } = {}
  ) => {
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
  }
);

ipcMain.handle(
  "save-pdf-buffer",
  async (event, { buffer, defaultPath = "document.pdf" } = {}) => {
    try {
      if (!buffer) throw new Error("No buffer provided");

      const data =
        buffer instanceof ArrayBuffer
          ? Buffer.from(buffer)
          : Buffer.from(buffer.buffer || buffer);
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
  }
);

/* -------------------- Optional: handle open-external -------------------- */
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

/* ---------- process-level error handlers ---------- */
process.on("unhandledRejection", (reason, promise) => {
  appendLog(`UnhandledRejection: ${String(reason)}`);
});
process.on("uncaughtException", (err) => {
  appendLog(`UncaughtException: ${err && err.stack ? err.stack : String(err)}`);
});
