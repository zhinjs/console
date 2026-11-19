export type ControlSwitchKey = 'emergency_stop' | 'muted' | 'read_only' | 'mention_only'
export interface ControlSwitchConfirm {
  title: string
  description: string
  confirmLabel: string
  variant: 'default' | 'destructive'
}
export function controlSwitchConfirm(key: string, turningOn: boolean, locale?: 'zh-CN' | 'en'): ControlSwitchConfirm | null
