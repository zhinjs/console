/** Refreshing evidence must never silently rebase a user-authored whole-file draft. */
export function editSourceDraft(previous, snapshot, source) {
  if (previous) return { ...previous, source }
  if (!snapshot?.revision || typeof snapshot.source !== 'string') throw new Error('配置版本未知，请先读取配置后编辑')
  return { source, snapshot: Object.freeze({ ...snapshot }) }
}
export function saveSourceDraft(saveBound, draft) {
  if (!draft?.snapshot?.revision) throw new Error('草稿版本未知，请撤销并重新读取配置')
  return saveBound(draft.source, draft.snapshot)
}
