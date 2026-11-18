/**
 * The adapter cells of the feature matrix (#64 `feature-matrix-adapter-receipt`) write through an
 * action receipt, like the 全局 column and the adapter's own 功能 tab: a write whose outcome is
 * unknown keeps the cell's switch disabled and offers only a read-only check, instead of a 「保存失败」
 * toast that lets the same write be sent again.
 */
import { FEATURE_RPC } from '@zhin.js/console-protocol'
import { outcomeFromFeatureWrite } from '../../components/apply-outcome-model.mjs'
import { readFeatureDetail, readFeatureWriteResult, setEnabledRequest } from './feature-model.mjs'
import { featureChangeApplied, featureReadBackMismatch, featureReceiptOutcome } from './feature-scope-model.mjs'

/**
 * Receipt key of a feature write at one level. The adapter's 功能 tab (feature-level-panel) uses the
 * same key, so the matrix and that tab show one receipt and cannot send one write twice.
 */
export function featureReceiptKey(level, levelKey, plugin) {
  return `feature:${level}:${levelKey}:${plugin}`
}

/** The receipt payload of an adapter switch; the same shape as the 功能 tab's (`{ body, change }`). */
export function adapterSwitchPayload({ plugin, adapter, enabled, revision }) {
  return { body: setEnabledRequest({ plugin, level: 'adapter', key: adapter, enabled, revision }), change: { kind: 'enabled', enabled } }
}

/**
 * `submit` / `verify` of the receipt. `request(body)` sends one console RPC; `reload()` re-reads the
 * matrix after every answer. A failed request is rethrown untouched: the receipt sorts it into
 * 未执行 / 结果未知 (`statusFromError`), and only a refusal lets the switch be used again.
 */
export function adapterSwitchHandlers({ plugin, adapter, request, reload, t = text => text }) {
  const readBack = async () => readFeatureDetail(await request({ type: FEATURE_RPC.GET, plugin, level: 'adapter', key: adapter }))
  const pendingOf = plan => plan?.payload
  return {
    async submit(plan) {
      const current = pendingOf(plan)
      if (!current) throw new Error('No change')
      try {
        const result = readFeatureWriteResult(await request(current.body))
        const outcome = featureReceiptOutcome(result)
        if (outcome.locked) throw Object.assign(new Error(outcome.message), { code: 'locked', lockedBy: outcome.lockedBy })
        const apply = outcomeFromFeatureWrite(result, 'adapter') ?? undefined
        if (result.status !== 'saved') return { ...outcome, apply }
        let mismatch = null
        try { mismatch = featureReadBackMismatch(await readBack(), current.change) }
        catch { return { ...outcome, apply, message: [outcome.message, t('保存后没能重新读取核对，请刷新确认保存的值。')].filter(Boolean).join('\n') } }
        return { ...outcome, apply, ...(mismatch ? { mismatch } : {}) }
      } finally {
        reload()
      }
    },
    async verify(plan) {
      const current = pendingOf(plan)
      if (!current) return undefined
      try {
        const applied = featureChangeApplied(await readBack(), current.change)
        return { applied, ...(applied ? { apply: outcomeFromFeatureWrite({ status: 'saved' }, 'adapter') ?? undefined } : {}) }
      } finally {
        reload()
      }
    },
  }
}
