'use strict';

;(function exposeHitMask(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.MORN_HIT_MASK = Object.freeze(api)
})(typeof window === 'object' ? window : null, () => {
  function createAlphaMask(image, options = {}) {
    const documentRef = options.document || (typeof document === 'object' ? document : null)
    const naturalWidth = Number(image?.naturalWidth)
    const naturalHeight = Number(image?.naturalHeight)
    if (!documentRef || !(naturalWidth > 0) || !(naturalHeight > 0)) return null

    const width = Math.max(16, Math.round(Number(options.width) || 160))
    const height = Math.max(16, Math.round(width * naturalHeight / naturalWidth))
    const canvas = documentRef.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    try {
      context.clearRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      const rgba = context.getImageData(0, 0, width, height).data
      const mask = new Uint8ClampedArray(width * height)
      for (let index = 0; index < mask.length; index += 1) mask[index] = rgba[index * 4 + 3]
      return { mask, width, height }
    } catch {
      return null
    }
  }

  function isOpaquePoint(maskInfo, rect, clientX, clientY, threshold = 16, paddingCells = 0) {
    const width = Number(maskInfo?.width)
    const height = Number(maskInfo?.height)
    const mask = maskInfo?.mask
    const rectWidth = Number(rect?.width)
    const rectHeight = Number(rect?.height)
    const x = Number(clientX)
    const y = Number(clientY)
    if (!mask || !(width > 0) || !(height > 0) || !(rectWidth > 0) || !(rectHeight > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false

    const normalizedX = (x - Number(rect.left)) / rectWidth
    const normalizedY = (y - Number(rect.top)) / rectHeight
    if (normalizedX < 0 || normalizedX >= 1 || normalizedY < 0 || normalizedY >= 1) return false

    const maskX = Math.min(width - 1, Math.floor(normalizedX * width))
    const maskY = Math.min(height - 1, Math.floor(normalizedY * height))
    const radius = Math.max(0, Math.round(Number(paddingCells) || 0))
    const minimumAlpha = Math.max(0, Math.min(255, Number(threshold) || 0))
    for (let sampleY = Math.max(0, maskY - radius); sampleY <= Math.min(height - 1, maskY + radius); sampleY += 1) {
      for (let sampleX = Math.max(0, maskX - radius); sampleX <= Math.min(width - 1, maskX + radius); sampleX += 1) {
        if (mask[sampleY * width + sampleX] >= minimumAlpha) return true
      }
    }
    return false
  }

  return { createAlphaMask, isOpaquePoint }
})
