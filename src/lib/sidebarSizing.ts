export const SIDEBAR_MIN = 160;
export const SIDEBAR_DEFAULTS = { left: 270, right: 230 };
export const SIDEBAR_MAX = { left: 480, right: 420 };
export const READER_MIN = 480;

export function sidebarWidth(value: unknown, side: "left" | "right"): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX[side], value)))
    : SIDEBAR_DEFAULTS[side];
}

/** Fit saved widths to a smaller window without overwriting the user's preference. */
export function fitSidebars(viewport: number, left: number, right: number): { left: number; right: number } {
  const excess = Math.max(0, left + right - Math.max(0, viewport - READER_MIN));
  const leftRoom = Math.max(0, left - SIDEBAR_MIN);
  const rightRoom = Math.max(0, right - SIDEBAR_MIN);
  const room = leftRoom + rightRoom;
  const reduction = Math.min(excess, room);
  const leftReduction = room ? Math.round(reduction * leftRoom / room) : 0;
  return { left: left - leftReduction, right: right - (reduction - leftReduction) };
}
