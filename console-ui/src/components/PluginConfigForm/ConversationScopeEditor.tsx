import { useI18n } from '../../i18n'
import { useState } from 'react'
import type { SchemaField } from './types.js'
import { Button } from '../ui/button'
import { ConversationTargetEditor } from './ConversationTargetEditor'
import { scopeAllowedKinds } from './conversation-scope-model.mjs'
import { updateListItem } from './schema-model.mjs'

export function ConversationScopeEditor({field, value, onChange}: {field: SchemaField; value: unknown; onChange: (value: unknown) => void}) {
  const i18n = useI18n()
  const [restoreAll, setRestoreAll] = useState<{ value: unknown; field: SchemaField } | null>(null)
  const allowedKinds = scopeAllowedKinds(field)
  return <div className="min-w-0 space-y-3">
    <p className="text-sm font-medium">{value === undefined ? i18n.t("草稿范围：全部符合插件条件的会话") : Array.isArray(value) && value.length === 0 ? i18n.t("草稿范围：不允许任何会话") : i18n.t("草稿范围：仅列表中的 {0} 个精确会话", [Array.isArray(value) ? value.length : ''])}</p>
    <p className="text-xs text-muted-foreground">{i18n.t("此处只修改配置草稿；保存并应用后才生效。账号、会话类型、ID、父容器和话题共同确定范围。")}</p>
    <p className="text-xs text-muted-foreground">{i18n.t("未填写父容器或话题时，只匹配同样不含该身份的会话，不会覆盖所有子频道或回复串。")}</p>
    {value === undefined ? <Button type="button" variant="outline" size="sm" onClick={() => { setRestoreAll(null); onChange([]) }}>{i18n.t("限定到所选会话（先设为空范围）")}</Button> : <>
      {!Array.isArray(value) ? <p role="alert" className="text-xs text-destructive">{i18n.t("当前值不是会话列表，原值仍保留。请切换源码修正，或明确设为空范围后重新选择。")}</p> : value.map((target, index) => <section key={index} className="min-w-0 space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">{i18n.t("会话 ")}{index + 1}</p>
        <ConversationTargetEditor value={target} allowedKinds={allowedKinds} onChange={next => onChange(updateListItem(value, index, next))} />
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>{i18n.t("移除此会话")}</Button>
      </section>)}
      <div className="flex flex-wrap gap-2">
        {Array.isArray(value) ? <Button type="button" variant="outline" size="sm" disabled={typeof field.max === 'number' && value.length >= field.max} onClick={() => onChange([...value, {}])}>{i18n.t("添加精确会话")}</Button> : null}
        <Button type="button" variant="outline" size="sm" onClick={() => { setRestoreAll(null); onChange([]) }}>{i18n.t("清空范围（不允许任何会话）")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRestoreAll({ value, field })}>{i18n.t("恢复覆盖全部…")}</Button>
      </div>
    </>}
    {typeof field.max === 'number' ? <p className="text-xs text-muted-foreground">{i18n.t("此字段最多 ")}{field.max} {i18n.t(" 个会话；已有草稿不会被自动截断。")}</p> : null}
    {restoreAll && restoreAll.value === value && restoreAll.field === field && value !== undefined ? <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-3 text-sm"><p>{i18n.t("恢复后将删除此范围限制，覆盖全部符合插件条件的会话，包括以后新接入的符合条件会话。确定扩大范围吗？")}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" size="sm" onClick={() => { setRestoreAll(null); onChange(undefined) }}>{i18n.t("确认恢复全部")}</Button><Button type="button" variant="outline" size="sm" onClick={() => setRestoreAll(null)}>{i18n.t("保留当前范围")}</Button></div></div> : null}
  </div>
}
