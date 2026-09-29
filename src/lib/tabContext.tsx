import { createContext, useContext, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

export const TabContext = createContext<string | null>(null);

export function useTabInvoke(): typeof invoke {
  const tabId = useContext(TabContext);
  return useMemo(() => tabId === null ? invoke : <T,>(command: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]) =>
    invoke<T>(command, { ...(args as Record<string, unknown> | undefined), tabId }, options), [tabId]);
}
