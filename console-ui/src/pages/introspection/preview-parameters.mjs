export function previewParameters(item) {
  const hasExample = Object.prototype.hasOwnProperty.call(item, 'previewProps')
  return { hasExample, text: JSON.stringify(hasExample ? item.previewProps : {}, null, 2) ?? '{}' }
}
export async function copyJson(value, clipboard) {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  await clipboard.writeText(text)
  return text
}
