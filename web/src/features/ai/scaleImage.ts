// Downscale a captured photo before sending it to the AI provider: receipts are
// legible well under full camera resolution, and a smaller JPEG means a cheaper,
// faster request (and less data leaving the device). Returns a base64 data URL.

export interface ScaledImage {
  dataUrl: string // "data:image/jpeg;base64,…" (also used for the preview)
  mime: string
}

async function loadBitmap(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if ('createImageBitmap' in window) {
    const bmp = await createImageBitmap(file)
    return { width: bmp.width, height: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() }
  }
  // Fallback for browsers without createImageBitmap.
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not load image'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function fileToScaledImage(file: File, maxDim = 1600, quality = 0.85): Promise<ScaledImage> {
  const src = await loadBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height))
  const width = Math.max(1, Math.round(src.width * scale))
  const height = Math.max(1, Math.round(src.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')
  src.draw(ctx, width, height)
  src.close()

  return { dataUrl: canvas.toDataURL('image/jpeg', quality), mime: 'image/jpeg' }
}
