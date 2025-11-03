import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("__BB_API_BASE__", "http://localhost:3001/api")
