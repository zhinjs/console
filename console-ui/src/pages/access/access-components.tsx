import { useId, useMemo, useState, type ReactNode } from 'react'
import { Plus, ShieldAlert, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { ErrorAlert } from '../../components/error-alert'
import { useEndpointList } from '../features/use-feature-data'
import {
  addBinding, areaLabel, builtinRoleLabel, groupCheckState, levelLabel, permissionLabel, removeBinding, scopeLabel, scopeProblem,
  togglePermissions, type BindingScope, type IamBinding, type IamRole, type PermissionGroup, type ScopeKind,
} from './access-model.mjs'
import type { IamErrorKind } from './iam-request.mjs'

/** Load failure of an access page; an old Host gets an update hint instead of a retry loop. */
export function IamLoadError({ error, kind, onRetry }: { error: string; kind: IamErrorKind | null; onRetry: () => void }) {
  if (kind === 'unsupported') {
    return (
      <Alert variant="warning">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  return <ErrorAlert error={error} onRetry={kind === 'forbidden' ? undefined : onRetry} kind={kind === 'unavailable' ? '503' : 'other'} />
}

export function ReadOnlyNotice() {
  const i18n = useI18n()
  return <p className="text-sm text-muted-foreground" role="note">{i18n.t("当前身份只能查看访问控制；修改需要 iam.manage 权限。")}</p>
}

export function FormField({ label, error, hint, children, htmlFor }: { label: string; error?: string | null; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}

export function RoleName({ role }: { role: string }) {
  const i18n = useI18n()
  const label = builtinRoleLabel(role, i18n.t)
  return label ? <span>{label} <span className="text-muted-foreground">({role})</span></span> : <span>{role}</span>
}

export function BindingBadges({ bindings }: { bindings: readonly IamBinding[] }) {
  const i18n = useI18n()
  if (!bindings.length) return <span className="text-muted-foreground">{i18n.t("无角色")}</span>
  return (
    <div className="flex flex-wrap gap-1">
      {bindings.map((binding, index) => (
        <Badge key={`${binding.role}-${index}`} variant={binding.role === 'owner' && binding.scope.kind === 'global' ? 'info' : 'secondary'} size="sm">
          {builtinRoleLabel(binding.role, i18n.t) ?? binding.role} · {scopeLabel(binding.scope, i18n.t)}
        </Badge>
      ))}
    </div>
  )
}

/** Role bindings with scope (global / adapter / endpoint); edits a local list. */
export function BindingsEditor({ bindings, roles, onChange, disabled }: {
  bindings: readonly IamBinding[]
  roles: readonly IamRole[]
  onChange: (bindings: readonly IamBinding[]) => void
  disabled?: boolean
}) {
  const i18n = useI18n()
  const id = useId()
  const [role, setRole] = useState(roles[0]?.name ?? '')
  const [kind, setKind] = useState<ScopeKind>('global')
  const [key, setKey] = useState('')
  const [touched, setTouched] = useState(false)
  const { endpoints } = useEndpointList()
  const suggestions = useMemo(() => kind === 'adapter'
    ? [...new Set(endpoints.map(item => item.adapter))]
    : kind === 'endpoint' ? endpoints.map(item => `${item.adapter}/${item.name}`) : [], [endpoints, kind])
  const problem = scopeProblem(kind, key, i18n.t)
  const selectedRole = roles.some(item => item.name === role) ? role : roles[0]?.name ?? ''
  const add = () => {
    setTouched(true)
    if (problem || !selectedRole) return
    const scope: BindingScope = kind === 'global' ? { kind: 'global' } : { kind, key }
    onChange(addBinding(bindings, { role: selectedRole, scope }))
    setKey('')
    setTouched(false)
  }
  return (
    <div className="space-y-3">
      {bindings.length ? (
        <ul className="space-y-1.5" aria-label={i18n.t("角色绑定")}>
          {bindings.map((binding, index) => (
            <li key={`${binding.role}-${binding.scope.kind}-${'key' in binding.scope ? binding.scope.key : ''}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate"><RoleName role={binding.role} /> · {scopeLabel(binding.scope, i18n.t)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(removeBinding(bindings, index))}
                aria-label={i18n.t("移除绑定 {0}", [`${binding.role} · ${scopeLabel(binding.scope, i18n.t)}`])}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{i18n.t("还没有角色绑定，该用户登录后什么也看不到。")}</p>}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <SelectField aria-label={i18n.t("角色")} value={selectedRole} onValueChange={setRole} disabled={disabled || !roles.length}
          options={roles.map(item => ({ value: item.name, label: builtinRoleLabel(item.name, i18n.t) ?? item.name }))} />
        <SelectField aria-label={i18n.t("作用域")} value={kind} onValueChange={value => setKind(value as ScopeKind)} disabled={disabled}
          options={[
            { value: 'global', label: i18n.t("全局") },
            { value: 'adapter', label: i18n.t("适配器") },
            { value: 'endpoint', label: i18n.t("账号") },
          ]} />
      </div>
      {kind !== 'global' ? (
        <FormField htmlFor={`${id}-key`} label={kind === 'adapter' ? i18n.t("适配器别名") : i18n.t("账号（别名/账号 ID）")}
          error={touched ? problem : null}
          hint={i18n.t("适配器与账号作用域只收窄账号与功能配置相关的权限，其余权限只在全局绑定时生效。")}>
          <Input id={`${id}-key`} value={key} list={`${id}-suggestions`} disabled={disabled} autoComplete="off" spellCheck={false}
            placeholder={kind === 'adapter' ? 'qq' : 'qq/123456'} onChange={event => setKey(event.target.value)} />
          <datalist id={`${id}-suggestions`}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>
        </FormField>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled || !selectedRole}><Plus />{i18n.t("添加绑定")}</Button>
    </div>
  )
}

/** Permission checklist grouped by area, then by plugin for plugin-declared permissions. */
export function PermissionChecklist({ groups, selected, onChange, disabled }: {
  groups: readonly PermissionGroup[]
  selected: readonly string[]
  onChange?: (permissions: string[]) => void
  disabled?: boolean
}) {
  const i18n = useI18n()
  const id = useId()
  const readOnly = disabled || !onChange
  return (
    <div className="space-y-4">
      {groups.map(group => {
        const names = group.permissions.map(item => item.permission)
        const state = groupCheckState(selected, names)
        const title = group.kind === 'area' ? areaLabel(group.id, i18n.t) : i18n.t("插件 {0}", [group.id])
        const groupId = `${id}-${group.kind}-${group.id}`
        return (
          <fieldset key={`${group.kind}:${group.id}`} className="space-y-1.5">
            <legend className="flex items-center gap-2 text-sm font-medium">
              <Checkbox id={groupId} checked={state} disabled={readOnly} aria-label={i18n.t("全选 {0}", [title])}
                onCheckedChange={checked => onChange?.(togglePermissions(selected, names, checked === true))} />
              <label htmlFor={groupId}>{title}</label>
            </legend>
            <ul className="grid gap-1 pl-6 sm:grid-cols-2">
              {group.permissions.map(item => {
                const itemId = `${groupId}-${item.permission}`
                const checked = selected.includes(item.permission)
                return (
                  <li key={item.permission} className="flex items-start gap-2 text-sm">
                    <Checkbox id={itemId} className="mt-0.5" checked={checked} disabled={readOnly}
                      onCheckedChange={value => onChange?.(togglePermissions(selected, [item.permission], value === true))} />
                    <label htmlFor={itemId} className="min-w-0">
                      <span className="block">{group.kind === 'area' ? permissionLabel(item.permission, i18n.t) : (item.description || item.permission)}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {item.permission}{item.level ? ` · ${levelLabel(item.level, i18n.t)}` : ''}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )
      })}
    </div>
  )
}
