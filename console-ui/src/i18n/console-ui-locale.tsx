import { useMemo, type ReactNode } from 'react'
import { ConsoleUiI18nProvider, type ConsoleUiMessages } from '@zhin.js/console-ui'
import { useI18n } from './index'

/**
 * Hands the Console's language and copy to `@zhin.js/console-ui` (ADR 0063 决策 1 第 5 条): the
 * components never read the Console's i18n, so every built-in message is passed in from the
 * Console's own catalog, which keeps one English translation for both.
 */
export function ConsoleUiLocale({ children }: { children?: ReactNode }) {
  const i18n = useI18n()
  const messages = useMemo<Partial<ConsoleUiMessages>>(() => ({
    'dialog.close': i18n.t('关闭'),
    'confirm.cancel': i18n.t('取消'),
    'confirm.confirm': i18n.t('确认'),
    'confirm.processing': i18n.t('处理中...'),
    'confirm.failed': i18n.t('操作失败，请重试或取消。'),
    'confirm.notCompleted': i18n.t('操作未完成：{0}'),
    'confirm.typeToConfirm': i18n.t('请输入 {0} 以确认：'),
    'empty.noData': i18n.t('这里还没有内容。'),
    'error.retry': i18n.t('重试'),
    'error.technicalDetail': i18n.t('技术详情'),
    'select.searchPlaceholder': i18n.t('搜索…'),
    'select.noMatch': i18n.t('没有匹配的选项'),
    'refresh.updatedAt': i18n.t('更新于 {0}'),
    'refresh.notYet': i18n.t('尚未更新'),
    'refresh.refresh': i18n.t('刷新'),
    'refresh.refreshing': i18n.t('刷新中…'),
    'refresh.interval': i18n.t('自动刷新间隔'),
    'refresh.manual': i18n.t('手动刷新'),
    'refresh.auto': i18n.t('{0}s 自动'),
    'stepper.decrease': i18n.t('减少'),
    'stepper.increase': i18n.t('增加'),
    'toast.undo': i18n.t('撤销', [], 'toast'),
  }), [i18n])
  return <ConsoleUiI18nProvider locale={i18n.locale} messages={messages}>{children}</ConsoleUiI18nProvider>
}
