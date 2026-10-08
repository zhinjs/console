function equal(left, right) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
}

function sameField(actual, expected, definition = {}) {
  if (equal(actual, expected)) return true
  if (actual === null || expected === null) return false
  const type = definition.type?.toLowerCase()
  if (type === 'boolean' && [true, false, 0, 1].includes(actual) && [true, false, 0, 1].includes(expected)) return Boolean(actual) === Boolean(expected)
  if (type === 'date') {
    const a = Date.parse(actual), b = Date.parse(expected)
    return Number.isFinite(a) && a === b
  }
  return false
}

export function relatedUpdateReadback(rows, patch, definitions = {}) {
  if (!rows.length) return 'missing'
  if (rows.length !== 1) return 'unconfirmed'
  return Object.entries(patch).every(([key, value]) => sameField(rows[0][key], value, definitions[key])) ? 'saved' : 'unconfirmed'
}
