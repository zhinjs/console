import { useId, useMemo, useState } from 'react'
import { Copy, Eye, Pencil, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Skeleton } from '../../components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { EmptyState } from '../../components/empty-state'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import {
  IAM_RPC, builtinRoleLabel, copyRoleName, permissionGroups, readPluginPermissionCatalog, readRoles, roleNameProblem,
  type IamRole, type PluginPermission,
} from './access-model.mjs'
import { FormField, IamLoadError, PermissionChecklist, ReadOnlyNotice } from './access-components'
import { iamRequest, useCanManageIam, useIamRead } from './use-iam'

interface RolesData { roles: IamRole[]; plugins: PluginPermission[] }
const EMPTY: RolesData = { roles: [], plugins: [] }
const readRolesData = (payload: unknown): RolesData => ({ roles: readRoles(payload), plugins: readPluginPermissionCatalog(payload) })

type Pending =
  | { kind: 'view'; role: IamRole }
  | { kind: 'edit'; role: IamRole | null; draft: { name: string; description: string; permissions: string[] } }
  | { kind: 'delete'; role: IamRole }

export default function AccessRolesPage() {
  const i18n = useI18n()
  const toast = useToast()
  const canManage = useCanManageIam()
  const state = useIamRead(IAM_RPC.ROLES_LIST, readRolesData, EMPTY)
  const { roles, plugins } = state.data
  const [pending, setPending] = useState<Pending | null>(null)
  const close = () => setPending(null)
  const groups = useMemo(() => permissionGroups(plugins, roles.flatMap(role => role.permissions)), [plugins, roles])

  const startCopy = (role: IamRole) => setPending({
    kind: 'edit', role: null,
    draft: { name: copyRoleName(role.name, roles), description: role.description, permissions: [...role.permissions] },
  })

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("角色")}
        description={i18n.t("角色是一组权限。内置角色只读，可以复制后修改；自定义角色删除时，绑定到它的用户会失去这些权限。")}
        actions={<>
          <Button variant="outline" size="sm" onClick={state.refresh} disabled={state.loading}><RefreshCw className={state.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {canManage ? <Button size="sm" onClick={() => setPending({ kind: 'edit', role: null, draft: { name: '', description: '', permissions: [] } })}><Plus />{i18n.t("新建角色")}</Button> : null}
        </>}
      />
      {!canManage ? <ReadOnlyNotice /> : null}
      {state.error ? <IamLoadError error={state.error} kind={state.errorKind} onRetry={state.refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {state.loading && !state.loaded ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !roles.length ? (
          <EmptyState icon={Shield} title={i18n.t("还没有角色")} />
        ) : (
          <Table aria-label={i18n.t("角色")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("角色")}</TableHead>
                <TableHead>{i18n.t("说明")}</TableHead>
                <TableHead numeric>{i18n.t("权限数")}</TableHead>
                <TableHead><span className="sr-only">{i18n.t("操作")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map(role => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{builtinRoleLabel(role.name, i18n.t) ?? role.name}</span>
                      {role.builtin ? <Badge variant="outline" size="sm">{i18n.t("内置")}</Badge> : null}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{role.name}</div>
                  </TableCell>
                  <TableCell className="max-w-md text-muted-foreground">{role.description || '—'}</TableCell>
                  <TableCell numeric>{role.permissions.length}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {role.builtin || !canManage
                        ? <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'view', role })}><Eye />{i18n.t("查看")}</Button>
                        : <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'edit', role, draft: { name: role.name, description: role.description, permissions: [...role.permissions] } })}><Pencil />{i18n.t("编辑")}</Button>}
                      {canManage ? <Button variant="ghost" size="sm" onClick={() => startCopy(role)}><Copy />{i18n.t("复制")}</Button> : null}
                      {canManage && !role.builtin
                        ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPending({ kind: 'delete', role })}><Trash2 />{i18n.t("删除")}</Button>
                        : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {pending?.kind === 'view' ? (
        <Dialog open onOpenChange={open => { if (!open) close() }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{builtinRoleLabel(pending.role.name, i18n.t) ?? pending.role.name}</DialogTitle>
              <DialogDescription>{pending.role.builtin ? i18n.t("内置角色不可修改，可以复制后再改。") : pending.role.description}</DialogDescription>
            </DialogHeader>
            <PermissionChecklist groups={groups} selected={pending.role.permissions} disabled />
          </DialogContent>
        </Dialog>
      ) : null}
      {pending?.kind === 'edit' ? (
        <RoleEditorDialog role={pending.role} initial={pending.draft} roles={roles} groups={groups} onClose={close}
          onSaved={name => { close(); toast.success(pending.role ? i18n.t("已保存角色 {0}", [name]) : i18n.t("已创建角色 {0}", [name])); state.refresh() }} />
      ) : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) close() }} variant="destructive"
          title={i18n.t("删除角色 {0}？", [pending.role.name])}
          description={i18n.t("绑定到这个角色的用户会失去它的全部权限，此操作不可恢复。")}
          confirmLabel={i18n.t("删除")}
          confirmText={pending.role.name}
          onConfirm={async () => {
            await iamRequest(IAM_RPC.ROLES_DELETE, { id: pending.role.id }, i18n.t)
            toast.success(i18n.t("已删除角色 {0}", [pending.role.name]))
            state.refresh()
          }} />
      ) : null}
    </PageShell>
  )
}

function RoleEditorDialog({ role, initial, roles, groups, onClose, onSaved }: {
  role: IamRole | null
  initial: { name: string; description: string; permissions: string[] }
  roles: readonly IamRole[]
  groups: ReturnType<typeof permissionGroups>
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const i18n = useI18n()
  const id = useId()
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [permissions, setPermissions] = useState<string[]>(initial.permissions)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameError = role ? null : roleNameProblem(name, roles, i18n.t)
  const submit = async () => {
    setTouched(true)
    if (nameError) return
    setSaving(true)
    setError(null)
    try {
      if (role) await iamRequest(IAM_RPC.ROLES_UPDATE, { id: role.id, description: description.trim(), permissions }, i18n.t)
      else await iamRequest(IAM_RPC.ROLES_CREATE, { name: name.trim(), description: description.trim(), permissions }, i18n.t)
      onSaved(role ? role.name : name.trim())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? i18n.t("编辑角色 {0}", [role.name]) : i18n.t("新建角色")}</DialogTitle>
          <DialogDescription>{i18n.t("修改立即对绑定了该角色的用户生效。")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
          <FormField htmlFor={`${id}-name`} label={i18n.t("角色名")} error={touched ? nameError : null}
            hint={role ? i18n.t("角色名创建后不可修改") : i18n.t("小写字母开头，可含数字、_ 与 -")}>
            <Input id={`${id}-name`} value={name} disabled={Boolean(role) || saving} autoComplete="off" spellCheck={false} onChange={event => setName(event.target.value)} />
          </FormField>
          <FormField htmlFor={`${id}-description`} label={i18n.t("说明（可选）")}>
            <Textarea id={`${id}-description`} value={description} rows={2} maxLength={512} disabled={saving} onChange={event => setDescription(event.target.value)} />
          </FormField>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{i18n.t("权限（已选 {0}）", [permissions.length])}</h3>
            <PermissionChecklist groups={groups} selected={permissions} onChange={setPermissions} disabled={saving} />
          </section>
          {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>{i18n.t("取消")}</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving ? i18n.t("处理中...") : role ? i18n.t("保存") : i18n.t("创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
