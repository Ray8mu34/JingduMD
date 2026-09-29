import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";

export async function launchQaBrowser() {
  if (process.env.QA_BROWSER === "webkit") return webkit.launch({ headless: true });
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  return chromium.launch({ headless: true, ...(process.platform === "win32" && existsSync(edge) ? { executablePath: edge } : {}) });
}
