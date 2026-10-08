import { fitWithin } from '../../core/charts'

export const FULL_MAX = 2400
export const THUMB_MAX = 400
const QUALITY = 0.85

/**
 * Resizes an image in the browser: a full copy (long side ≤ 2400px) and a
 * thumbnail (≤ 400px). WebP when the browser can encode it, else JPEG
 * (older iOS Safari cannot write WebP).
 */
export async function prepareImage(file: Blob): Promise<{ mime: string; data: ArrayBuffer; thumb: ArrayBuffer }> {
  const bmp = await createImageBitmap(file)
  try {
    const full = await encode(bmp, FULL_MAX)
    const thumb = await encode(bmp, THUMB_MAX, full.type)
    return { mime: full.type, data: await full.arrayBuffer(), thumb: await thumb.arrayBuffer() }
  } finally {
    bmp.close()
  }
}

async function encode(bmp: ImageBitmap, max: number, forceType?: string): Promise<Blob> {
  const { w, h } = fitWithin(bmp.width, bmp.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 브라우저는 이미지를 처리할 수 없습니다.')
  ctx.drawImage(bmp, 0, 0, w, h)
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, QUALITY))
  if (forceType) {
    const b = await toBlob(forceType)
    if (b) return b
  }
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg')
  if (!jpeg) throw new Error('이미지를 변환하지 못했습니다.')
  return jpeg
}
