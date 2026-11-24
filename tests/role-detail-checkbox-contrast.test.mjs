import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { grantedPermissionView, permissionGroups, rolePermissionCount } from '../console-ui/src/pages/access/access-model.mjs'

// #64 `role-detail-checkbox-contrast` (the part that is not styling): 「查看」 on a built-in role listed all
// 90 permissions as disabled checkboxes, so finding what the role actually has meant scanning every row,
// and the dialog showed 13 ticks for a role the list counted as 11, because each fully held group's
// 「全选」 box was ticked too. The checkbox contrast itself is left to #125 (style freeze).
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const plugins = [
  { permission: 'plugin.music.play', plugin: 'music', description: '播放' },
  { permission: 'plugin.music.admin', plugin: 'music', description: '管理' },
]

test('the read-only view lists only the granted permissions, by group, with the same count as the list', () => {
  const groups = permissionGroups(plugins)
  const selected = ['status.view', 'endpoint.view', 'endpoint.operate', 'plugin.music.play', 'status.view']
  const view = grantedPermissionView(groups, selected)
  assert.equal(view.total, 4, 'duplicates count once')
  // The roles list counts the same way, so a Host reply with a repeated permission cannot make them differ.
  assert.equal(rolePermissionCount(selected), view.total)
  assert.equal(view.plugin, 1, 'how many of them are plugin permissions')
  assert.deepEqual(view.groups.map(group => [group.kind, group.id, group.permissions.map(item => item.permission)]), [
    ['area', 'status', ['status.view']],
    ['area', 'endpoint', ['endpoint.view', 'endpoint.operate']],
    ['plugin', 'music', ['plugin.music.play']],
  ])
  assert.equal(view.catalogSize, groups.flatMap(group => group.permissions).length)
  assert.deepEqual(view.unlisted, [])
})

test('a granted permission no group knows is still shown, and an empty role says so', () => {
  const view = grantedPermissionView(permissionGroups(), ['status.view', 'future.thing'])
  assert.equal(view.total, 2)
  assert.deepEqual(view.unlisted, ['future.thing'])
  const empty = grantedPermissionView(permissionGroups(), [])
  assert.deepEqual([empty.total, empty.groups.length, empty.unlisted.length], [0, 0, 0])
})

test('the dialog uses the granted view with a 「显示全部」 switch; group 「全选」 boxes only appear when editing', () => {
  const roles = read('pages/access/roles.tsx')
  const dialog = roles.slice(roles.indexOf("{pending?.kind === 'view' ? ("), roles.indexOf("{pending?.kind === 'edit' ? ("))
  assert.match(dialog, /<RolePermissionView groups=\{groups\} selected=\{pending\.role\.permissions\} \/>/)
  assert.doesNotMatch(dialog, /<PermissionChecklist/)
  const components = read('pages/access/access-components.tsx')
  const view = components.slice(components.indexOf('export function RolePermissionView('))
  assert.match(view, /grantedPermissionView\(groups, selected\)/)
  assert.match(view, /i18n\.t\("已授予 \{0\} 项权限", \[granted\.total\]\)/)
  assert.match(view, /i18n\.t\("显示全部 \{0\} 项权限", \[granted\.catalogSize\]\)/)
  assert.match(view, /<PermissionChecklist groups=\{groups\} selected=\{selected\} disabled \/>/)
  assert.match(view, /i18n\.t\("已授予 \{0\} 项权限，其中插件权限 \{1\} 项", \[granted\.total, granted\.plugin\]\)/)
  // The switch's label says what it does; no aria-pressed that would contradict it. 44px on touch widths.
  assert.doesNotMatch(view, /aria-pressed/)
  assert.match(view, /className="max-md:min-h-11"/)
  // Unlisted permissions sit outside the showAll branch, so 「显示全部」 never hides them.
  assert.ok(view.indexOf('granted.unlisted.length') > view.lastIndexOf('      )}\n'), 'unlisted rendered in both modes')
  assert.match(roles, /<TableCell numeric>\{rolePermissionCount\(role\.permissions\)\}<\/TableCell>/)
  // In PermissionChecklist the group box exists only when there is something to change.
  const checklist = components.slice(components.indexOf('export function PermissionChecklist('), components.indexOf('export function RolePermissionView('))
  assert.match(checklist, /\{onChange \? <Checkbox id=\{groupId\}/)
})
