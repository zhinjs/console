import { translate } from '../i18n/locale.mjs'

/**
 * What turning on one of the home page's AI control switches does (#64 `control-switches-no-confirm`).
 * The effects follow the decision replay's reasons (`control_emergency_stop`, `control_muted_instance`,
 * `control_read_only`, `control_mention_only`).
 */
const EFFECTS = {
  emergency_stop: {
    title: '打开紧急停机？',
    description: '机器人会在所有会话里停止 AI 回复，直到关闭这个开关。',
    confirmLabel: '确认停机',
    variant: 'destructive',
  },
  muted: {
    title: '打开全局静默？',
    description: '机器人整体静音，在所有会话里都不会回复，直到关闭这个开关。',
    confirmLabel: '确认静默',
    variant: 'destructive',
  },
  read_only: {
    title: '打开只读观察？',
    description: '机器人进入只读模式：照常接收消息，但在所有会话里都不回复，直到关闭这个开关。',
    confirmLabel: '确认只读',
    variant: 'destructive',
  },
  mention_only: {
    title: '打开仅提及响应？',
    description: '机器人在所有会话里只在被 @ 时回复，其余消息都不回。',
    confirmLabel: '确认打开',
    variant: 'default',
  },
}

/**
 * The confirmation shown before a switch is turned on, or `null` when none is needed (turning a
 * switch off only restores normal replies).
 */
export function controlSwitchConfirm(key, turningOn, locale = 'zh-CN') {
  if (!turningOn || !Object.hasOwn(EFFECTS, key)) return null
  const t = message => translate(locale, message)
  const effect = EFFECTS[key]
  return {
    title: t(effect.title),
    description: `${t(effect.description)}${t('目前只有首页会显示这个开关的状态，其他页面不会提醒，用完记得回来关闭。')}`,
    confirmLabel: t(effect.confirmLabel),
    variant: effect.variant,
  }
}
