// Desktop WKWebView reports MacIntel on both Intel and Apple Silicon Macs.
export function isMacPlatform(platform: string): boolean { return /mac/i.test(platform); }
export const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
export function primaryModifier(event: { ctrlKey: boolean; metaKey: boolean }, mac = isMac): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}
export function shortcutLabel(label: string, mac = isMac): string {
  return mac ? label.replace(/Ctrl/g, "⌘").replace(/Shift/g, "⇧") : label;
}
