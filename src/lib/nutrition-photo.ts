export const MAX_NUTRITION_PHOTO_BYTES = 25 * 1024 * 1024;

/** Keep uploads within the private Storage bucket limit while accepting normal phone photos. */
export async function preparePhotoForAi(file: File): Promise<File> {
  const MAX_UPLOAD_BYTES = 6.5 * 1024 * 1024;
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Photo illisible."));
      element.src = url;
    });
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Préparation de la photo impossible.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Compression de la photo impossible.")), "image/jpeg", 0.82);
    });
    return new File([blob], "pace-nutrition.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
