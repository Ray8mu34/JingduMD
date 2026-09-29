import { fitSidebars, sidebarWidth } from "./sidebarSizing";

describe("sidebar sizing", () => {
  it("validates saved widths and preserves separate defaults", () => {
    expect(sidebarWidth(undefined, "left")).toBe(270);
    expect(sidebarWidth(NaN, "right")).toBe(230);
    expect(sidebarWidth(-1, "left")).toBe(160);
    expect(sidebarWidth(900, "right")).toBe(420);
  });
  it("reserves 480px for reading when both saved sidebars are wide", () => {
    const widths = fitSidebars(1080, 480, 420);
    expect(widths.left + widths.right).toBe(600);
    expect(widths.left).toBeGreaterThanOrEqual(160);
    expect(widths.right).toBeGreaterThanOrEqual(160);
    expect(fitSidebars(1600, 480, 420)).toEqual({ left: 480, right: 420 });
  });
  it("does not reserve space for hidden sidebars", () => {
    expect(fitSidebars(1080, 480, 0)).toEqual({ left: 480, right: 0 });
    expect(fitSidebars(1080, 0, 420)).toEqual({ left: 0, right: 420 });
  });
});
