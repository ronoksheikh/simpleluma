import { inBlankPage } from './browser.js';

export interface ImageInfo {
  width: number;
  height: number;
  /** Most common colours as hex. */
  colors: string[];
  /** The image as a PNG no larger than 1024px, base64, so a vision model can look at it. */
  png: string;
}

/** Size, palette and a viewable PNG of an image or SVG. */
export function inspectImage(data: Buffer, mime: string): Promise<ImageInfo> {
  return inBlankPage(async ({ url }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const big = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    big.getContext('2d')!.drawImage(img, 0, 0, big.width, big.height);
    const png = await big.convertToBlob({ type: 'image/png' });
    const small = new OffscreenCanvas(48, 48);
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(img, 0, 0, 48, 48);
    const { data: px } = sctx.getImageData(0, 0, 48, 48);
    const buckets = new Map<string, number>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! < 128) continue;
      const key = [px[i]!, px[i + 1]!, px[i + 2]!].map((v) => Math.min(255, Math.round(v / 16) * 16).toString(16).padStart(2, '0')).join('');
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      width,
      height,
      colors: [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([hex]) => `#${hex}`),
      png: btoa(binary),
    };
  }, { url: `data:${mime};base64,${data.toString('base64')}` });
}
