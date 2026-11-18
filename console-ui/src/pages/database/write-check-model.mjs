/**
 * 「核对」 after a database write ended with an unknown outcome (#64 database-insert-unknown-outcome).
 * The check only reads (`db:select`); it never sends the write again. The plan is built from what was
 * just submitted:
 * - insert: the submitted fields with plain values (string / number / boolean) as an equality `where`;
 *   found → applied. Without such fields the check cannot tell (`undetermined`).
 * - update: the row the identity points at after the write, compared with the submitted values.
 * - delete: the identity of the deleted row; gone → applied.
 */
import { relatedUpdateReadback } from './related-update-result.mjs'

const plain = value => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/** Equality `where` from the plain-valued fields of a submitted row; null when it has none. */
export function insertCheckWhere(row) {
  const where = Object.fromEntries(Object.entries(row ?? {}).filter(([, value]) => plain(value)))
  return Object.keys(where).length ? where : null
}

/** What 「核对」 will read for a write: `{ kind, where, row? }`, or `{ kind, where: null }` when nothing can be looked up. */
export function writeCheckPlan(kind, { row, where } = {}) {
  if (kind === 'insert') return { kind, where: insertCheckWhere(row), row }
  if (kind === 'update') return { kind, where: where ?? null, row }
  return { kind: 'delete', where: where ?? null }
}

/**
 * Runs the check: `select(where)` → `{ verdict: 'applied' | 'not-applied' | 'undetermined', count? }`.
 * A failed read throws (the outcome stays unknown).
 */
export async function runWriteCheck(plan, select, definitions) {
  if (!plan?.where) return { verdict: 'undetermined' }
  const result = await select(plan.where)
  const rows = Array.isArray(result?.rows) ? result.rows : []
  const total = Number.isFinite(result?.total) ? result.total : rows.length
  if (plan.kind === 'insert') return total > 0 ? { verdict: 'applied', count: total } : { verdict: 'not-applied', count: 0 }
  if (plan.kind === 'delete') return total === 0 ? { verdict: 'applied', count: 0 } : { verdict: 'not-applied', count: total }
  return relatedUpdateReadback(rows, plan.row ?? {}, definitions) === 'saved' ? { verdict: 'applied', count: total } : { verdict: 'not-applied', count: total }
}

/** Authored copy for a verdict (translated by the caller). */
export function writeCheckCopy(kind, verdict) {
  if (verdict === 'undetermined') return '无法自动核对：提交的内容里没有可用于查找的字段。请关闭后刷新列表，人工确认是否已写入。'
  if (kind === 'insert') return verdict === 'applied' ? '核对结果：已找到与刚提交内容一致的记录（{0} 条），这次添加已经写入。' : '核对结果：没有找到这次添加的记录，可以重新保存。'
  if (kind === 'update') return verdict === 'applied' ? '核对结果：修改已经写入。' : '核对结果：记录还是修改前的内容，可以重新保存。'
  return verdict === 'applied' ? '核对结果：记录已删除。' : '核对结果：记录仍在，这次删除没有执行。'
}
