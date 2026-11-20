/**
 * Client-side image compression and resizing utility for mobile and desktop uploads.
 * Downscales oversized screenshots (e.g. 4-7MB Retina iPhone captures)
 * to crisp ~400-800KB images, preserving text readability for OCR while
 * drastically reducing upload latency and mobile data usage.
 */
export async function optimizeScreenshot(file: File, maxDimension = 2400, quality = 0.92): Promise<File> {
  const isStandardWebImage = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp";
  const isImageFile = file.type.startsWith("image/") || /\.(?:png|jpe?g|webp|heic|heif)$/i.test(file.name);

  if (!isImageFile) {
    return file;
  }

  // If already standard web format and under 1 MB, no compression needed
  if (isStandardWebImage && file.size <= 1024 * 1024) {
    return file;
  }

  // Only run in browser environment
  if (typeof window === "undefined" || (!window.createImageBitmap && !window.Image)) {
    return file;
  }

  try {
    const bitmap = await (async () => {
      if ("createImageBitmap" in window) {
        return await createImageBitmap(file);
      }
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    })();

    const { width, height } = bitmap;
    let targetWidth = width;
    let targetHeight = height;

    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        targetWidth = maxDimension;
        targetHeight = Math.round((height * maxDimension) / width);
      } else {
        targetHeight = maxDimension;
        targetWidth = Math.round((width * maxDimension) / height);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Use high quality image smoothing for sharp text
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }

    // Export as high-quality JPEG (or WebP if preferred by browser)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });

    if (!blob) {
      return file;
    }

    if (blob.size >= file.size && isStandardWebImage) {
      return file;
    }

    const newFilename = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
    return new File([blob], newFilename, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    // If any canvas error occurs, gracefully fallback to original file
    return file;
  }
}
