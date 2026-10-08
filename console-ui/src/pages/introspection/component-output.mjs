/** Unwrap only the source-owned RawContent envelope, retaining unknown payloads for JSON fallback. */
export function unwrapComponentOutput(value, depth = 0) {
  if (depth > 64) return value
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const next = unwrapComponentOutput(item, depth + 1)
      return Array.isArray(next) ? next : [next]
    })
  }
  if (value && typeof value === 'object' && value.$content === 'zhin.raw-content/1' && Object.hasOwn(value, 'payload')) {
    return unwrapComponentOutput(value.payload, depth + 1)
  }
  return value
}
