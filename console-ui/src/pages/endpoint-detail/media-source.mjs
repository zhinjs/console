/** Canonical MediaRef must retain its kind and MIME before the SDK's URL safety check. */
export function pickMessageMediaRaw(data, pickLegacy) {
  const media = data?.media
  if (media && typeof media === 'object') {
    if (typeof media.value !== 'string' || !media.value.trim()) return undefined
    if (media.kind === 'url') return media.value.trim()
    if (media.kind === 'base64') {
      if (typeof media.mime_type !== 'string' || !media.mime_type.trim()) return undefined
      return `data:${media.mime_type.trim()};base64,${media.value.trim()}`
    }
    // Local paths, byte objects and streams cannot be fetched by a remote browser.
    return undefined
  }
  return pickLegacy(data)
}
