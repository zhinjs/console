export function relatedPrimaryKeys(definitions = {}) {
  return Object.entries(definitions).filter(([, column]) => column.primary).map(([name]) => name)
}

export function relatedRowIdentity(keys, row) {
  if (!keys.length) throw new Error('数据表未声明主键，无法安全定位记录。')
  const where = {}
  for (const key of keys) {
    if (row?.[key] === undefined || row[key] === null) throw new Error('记录缺少主键，无法安全定位。')
    where[key] = row[key]
  }
  return where
}
