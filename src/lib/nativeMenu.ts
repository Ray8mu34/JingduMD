import { useEffect, useLayoutEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isMac } from "./platform";

export function useNativeMenu(onAction: (action: string) => void): void {
  const handler = useRef(onAction);
  useLayoutEffect(() => { handler.current = onAction; });
  useEffect(() => {
    if (!isMac || !isTauri()) return;
    let active = true;
    const pending = listen<string>("reader-menu-action", ({ payload }) => {
      if (active) handler.current(payload);
    });
    return () => { active = false; void pending.then((unlisten) => unlisten()); };
  }, []);
}
