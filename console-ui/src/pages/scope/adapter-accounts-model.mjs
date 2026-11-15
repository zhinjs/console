/**
 * Who draws the adapter's accounts. The Console's table rows carry each account's switch, 编辑 and
 * 删除 only once the SDK's account controller is `ready`. While it is `loading`, after an `error`,
 * or for a Host without an account directory (`unmanaged`, older Hosts), the rows have no controls:
 * the SDK page under 「管理连接」 keeps its own account cards, editor and status (`hostAccounts`
 * off), and the copy says so. Pure: the pages and the tests share it.
 */

/** Whether the Console renders the accounts itself (`AdapterConsolePage` `hostAccounts`). */
export function hostRendersAccounts(accounts) {
  return accounts?.state === 'ready'
}

/** Authored copy (displayed through i18n) for the account list and the 「管理连接」 summary. */
export const ACCOUNT_LIST_COPY = Object.freeze({
  host: '点账号进入它的页面：会话、聊天、接入、功能与角色。每行的开关启停账号；添加账号在列表下方的「管理连接」里。',
  sdk: '点账号进入它的页面：会话、聊天、接入、功能与角色。添加、编辑与启停在列表下方的「管理连接」里。',
})
export const CONNECTION_MANAGER_COPY = Object.freeze({
  host: '添加账号、编辑表单、登录与平台操作（由适配器插件提供）',
  sdk: '添加、编辑、启停账号与登录方式（由适配器插件提供）',
})

/** `{ hostAccounts, listDescription, managerHint }` for the adapter page. */
export function adapterAccountsView(accounts) {
  const host = hostRendersAccounts(accounts)
  const key = host ? 'host' : 'sdk'
  return Object.freeze({ hostAccounts: host, listDescription: ACCOUNT_LIST_COPY[key], managerHint: CONNECTION_MANAGER_COPY[key] })
}
