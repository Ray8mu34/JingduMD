// The macOS native command resolves only when its print operation ends. WebKit's
// afterprint event is not a reliable completion signal for a native print panel.
export async function completePrintJob(print: () => unknown | Promise<unknown>, restore: () => void, nativeCompletion: boolean): Promise<void> {
  let restored = false;
  const finish = () => {
    if (restored) return;
    restored = true;
    window.removeEventListener("afterprint", finish);
    restore();
  };
  if (!nativeCompletion) window.addEventListener("afterprint", finish, { once: true });
  try { await print(); }
  finally { finish(); }
}
