/**
 * ADR 0050 §3: a plugin block's reserved `overrides` key (adapter / endpoint feature overrides)
 * is owned by the `feature.*` RPC. Whole-block saves (the Schema form) must never drop or
 * rewrite it, whatever the draft holds — the baseline's value always wins.
 */
export const FEATURE_OVERRIDES_KEY = 'overrides'

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function preserveFeatureOverrides(next, current) {
  if (!isRecord(next)) return next
  const kept = isRecord(current) && Object.hasOwn(current, FEATURE_OVERRIDES_KEY)
  const result = {}
  for (const [key, value] of Object.entries(next)) {
    if (key !== FEATURE_OVERRIDES_KEY) result[key] = value
    // Keep the key in place; a draft-invented `overrides` (e.g. filled schema defaults) is dropped.
    else if (kept) result[key] = structuredClone(current[FEATURE_OVERRIDES_KEY])
  }
  if (kept && !Object.hasOwn(result, FEATURE_OVERRIDES_KEY)) result[FEATURE_OVERRIDES_KEY] = structuredClone(current[FEATURE_OVERRIDES_KEY])
  return result
}
