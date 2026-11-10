/*
 * Phone photos are often 3–6 MB; on mobile data that is slow and costly. Before upload, large
 * JPEG/PNG/WebP photos are redrawn at most 1600 px on the long side as JPEG (quality 0.85), which
 * keeps an ID card readable at a few hundred KB. PDFs and small images are sent unchanged. If the
 * browser cannot decode the image, the original is sent and the server checks it as usual.
 */
const MAX_SIDE = 1600;
const SHRINK_ABOVE_BYTES = 600 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.floor(bitmap.width * scale));
    const height = Math.max(1, Math.floor(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob === null || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]*$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
