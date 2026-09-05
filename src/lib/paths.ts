function isWindowsPath(path: string): boolean { return /^[A-Za-z]:[\\/]|^\\\\/.test(path); }

export function dirname(path: string): string {
  const normalized = isWindowsPath(path) ? path.replace(/\\/g, "/") : path;
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "." : normalized.slice(0, index) || "/";
}

export function resolveLocalPath(documentPath: string, source: string): string {
  const decoded = decodeURIComponent(source.split("#")[0]);
  const base = dirname(documentPath);
  const windows = isWindowsPath(documentPath);
  const local = windows ? decoded.replace(/\\/g, "/") : decoded;
  const baseDrive = /^[A-Za-z]:/.exec(base)?.[0] ?? "";
  const absolute = /^[A-Za-z]:\//.test(local) || local.startsWith("//") ? local
    : local.startsWith("/") ? `${windows ? baseDrive : ""}${local}` : `${base}/${local}`;
  const drive = /^[A-Za-z]:/.exec(absolute)?.[0] ?? "";
  const unc = windows && absolute.startsWith("//");
  const parts = absolute.replace(/^[A-Za-z]:/, "").split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") { if (output.length > (unc ? 2 : 0)) output.pop(); } else output.push(part);
  }
  return windows ? `${unc ? "\\\\" : `${drive}\\`}${output.join("\\")}` : `/${output.join("/")}`;
}

export function isExternalUrl(url: string): boolean { return /^(https?:|mailto:)/i.test(url); }
