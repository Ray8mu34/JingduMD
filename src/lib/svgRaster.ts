// Keep the original SVG for zoom/print, but paint a bounded bitmap in prose.
// This avoids WebView repeatedly replaying vector glyphs during text selection.
export function isAnimatedSvg(source: string) {
  return /<(?:[\w-]+:)?(?:animate(?:Motion|Transform)?|set)\b|\banimation(?:-[\w-]+)?\s*[:=]|@(?:-webkit-)?keyframes\b/i.test(source);
}

export function svgRasterSize(width: number, height: number, dpr: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  const scale = Math.min(Math.max(2, Math.min(4, dpr * 2)), 4096 / width, 4096 / height, Math.sqrt(8_000_000 / width / height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export async function rasterizeSvg(image: HTMLImageElement): Promise<Blob | null> {
  const size = svgRasterSize(image.naturalWidth, image.naturalHeight, window.devicePixelRatio || 1);
  if (!size) return null;
  const canvas = document.createElement("canvas");
  try {
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  } catch {
    // Unsupported canvas, memory limits or a tainted SVG must not hide the image.
    return null;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
