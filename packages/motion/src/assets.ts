/** Load an image (PNG, JPG, SVG…) before the first frame: `const logo = await loadImage(new URL('../assets/logo.svg', import.meta.url))`. */
export async function loadImage(src: string | URL): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = String(src);
  await img.decode();
  return img;
}

/** Load a font file and register it under `family`. */
export async function loadFont(family: string, src: string | URL, descriptors?: FontFaceDescriptors): Promise<void> {
  const face = new FontFace(family, `url(${String(src)})`, descriptors);
  document.fonts.add(await face.load());
}
