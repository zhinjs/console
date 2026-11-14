import type { ReactNode } from 'react'

/**
 * Action slot of an account that exists only in configuration (not running) in the adapter's
 * 聊天账号 table. The table renders this cell for every such row; account actions (for example
 * importing the configured account into management) render here. Empty until an action exists.
 */
export function ConfiguredAccountActions(_props: { adapter: string; endpoint: string }): ReactNode {
  return null
}
