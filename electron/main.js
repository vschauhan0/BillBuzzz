import { app, BrowserWindow } from "electron"
import path from "node:path"
import { spawn } from "node:child_process"
import url from "node:url"

let mainWindow
let serverProcess

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(process.cwd(), "electron", "preload.js"),
    },
  })

  // In production, load index.html bundled by Vite; during dev you may point to Vite dev server.
  const startUrl =
    process.env.VITE_DEV_SERVER_URL || url.pathToFileURL(path.join(process.cwd(), "index.html")).toString()

  mainWindow.loadURL(startUrl)
  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

function startServer() {
  // Start the Node/Express API server
  const serverPath = path.join(process.cwd(), "server", "index.js")
  serverProcess = spawn(process.execPath, [serverPath], { stdio: "inherit" })
}

app.whenReady().then(() => {
  startServer()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (serverProcess) serverProcess.kill()
    app.quit()
  }
})
