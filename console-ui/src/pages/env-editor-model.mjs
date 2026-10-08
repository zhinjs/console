const secretName = /PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL/i
const mask = value => '●'.repeat(Math.min(value.length, 20))

function quoteEnds(value, quote, start = 0) {
  for (let i = start; i < value.length; i++) {
    if (value[i] !== quote) continue
    let escapes = 0
    for (let j = i - 1; j >= 0 && value[j] === '\\'; j--) escapes++
    if (escapes % 2 === 0) return true
  }
  return false
}

export function maskEnvContent(content) {
  let continuation = null
  return content.split(/(\r\n|\n|\r)/).map((line, index) => {
    if (index % 2) return line
    if (continuation) {
      const { quote, secret } = continuation
      if (quoteEnds(line, quote)) continuation = null
      return secret ? mask(line) : line
    }
    const assignment = line.match(/^(\s*(?:export\s+)?([\w.-]+)\s*=\s*)(.*)$/)
    if (!assignment) return line
    const [, prefix, name, value] = assignment
    const secret = secretName.test(name)
    const quote = /^["'`]/.test(value) ? value[0] : null
    if (quote && !quoteEnds(value, quote, 1)) continuation = { quote, secret }
    // Preserve only a complete variable reference, never a reference followed by a literal secret.
    if (!secret || !value.trim() || /^\$\{[^}]+\}$/.test(value.trim())) return line
    return prefix + mask(value)
  }).join('')
}
export function envEditorAccess({ loaded, readOnly, saving, masked, dirty }) {
  return {
    canEdit: loaded && !readOnly && !saving && !masked,
    canSave: loaded && !readOnly && !saving && dirty,
  }
}
