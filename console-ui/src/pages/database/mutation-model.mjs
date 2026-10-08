export function createMutationGate() {
  let pending = false
  return {
    get pending() { return pending },
    async run(operation) {
      if (pending) return false
      pending = true
      try { await operation(); return true } finally { pending = false }
    },
  }
}

export function documentTarget(doc) {
  const id = doc?._id
  if (id === undefined || id === null || id === '' || typeof id === 'object') {
    throw new Error('此文档缺少有效 _id，无法安全编辑或删除。')
  }
  return { _id: id }
}

export function parseDocument(text) {
  const doc = JSON.parse(text)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('文档必须是 JSON 对象。')
  return doc
}

export function assertNewKey(key, entries) {
  if (!key.trim()) throw new Error('Key 不能为空。')
  if (entries.some(entry => entry.key === key)) throw new Error('该 Key 已存在，请通过编辑修改它。')
}
