import { afterEach, describe, expect, it, vi } from "vitest";
import { isAnimatedSvg, rasterizeSvg, svgRasterSize } from "./svgRaster";

afterEach(() => vi.restoreAllMocks());

describe("SVG prose bitmap", () => {
  it("preserves animated SVGs instead of freezing them", () => {
    expect(isAnimatedSvg('<svg><animateTransform attributeName="transform"/></svg>')).toBe(true);
    expect(isAnimatedSvg('<style>@keyframes pulse {to {opacity:0}}</style>')).toBe(true);
    expect(isAnimatedSvg('<path style="animation: pulse 1s infinite"/>')).toBe(true);
    expect(isAnimatedSvg('<svg><path d="M0 0L1 1"/></svg>')).toBe(false);
  });
  it("keeps small figures crisp and caps large bitmap memory", () => {
    expect(svgRasterSize(640, 320, 2)).toEqual({ width: 2560, height: 1280 });
    for (const [width, height] of [[12000, 12000], [1000000, 1], [100, 80000]]) {
      const size = svgRasterSize(width, height, 3)!;
      expect(size.width).toBeLessThanOrEqual(4096);
      expect(size.height).toBeLessThanOrEqual(4096);
      expect(size.width * size.height).toBeLessThanOrEqual(8_000_000);
    }
    expect(svgRasterSize(0, 10, 1)).toBeNull();
    expect(svgRasterSize(Infinity, 10, 1)).toBeNull();
  });

  it("draws once and releases the canvas backing store", async () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    let canvas!: HTMLCanvasElement;
    const blob = new Blob(["pixels"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      canvas = this;
      callback(blob);
    });
    expect(await rasterizeSvg({ naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement)).toBe(blob);
    expect(draw).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("falls back to the original SVG when canvas drawing fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() { throw new Error("tainted canvas"); } } as unknown as CanvasRenderingContext2D);
    expect(await rasterizeSvg({ naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement)).toBeNull();
  });
});
