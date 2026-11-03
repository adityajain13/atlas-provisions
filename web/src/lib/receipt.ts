/**
 * Photo to JPEG at most 1600 px on the long side (small enough to send, big enough to read).
 * Returns base64 without the data-URL prefix. Adapted from the travel planner's receipt helper.
 */
export async function photoToJpeg(file: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  const img =
    bmp ??
    (await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = URL.createObjectURL(file);
    }));
  const w = 'width' in img ? img.width : 0;
  const h = 'height' in img ? img.height : 0;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]!;
}
