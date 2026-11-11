import { useI18n } from '../i18n'
import { LogIn, Unplug } from 'lucide-react'
import { notifyAuthRequired } from '../utils/auth'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { EmptyState } from './empty-state'
import { PageHeader } from './PageHeader'
import { PageShell } from './PageShell'

interface ConnectionRequiredStateProps {
  /** 页面标题；传入时保留页头，让用户知道自己在哪个页面 */
  title?: string
  description?: string
}

/**
 * 未连接 / 登录态失效时的页面占位，替代整页空白。
 * 「重新登录」沿用 notifyAuthRequired：清除旧 Token 并回到登录页。
 */
export function ConnectionRequiredState({ title, description }: ConnectionRequiredStateProps) {
  const i18n = useI18n()
  return (
    <PageShell>
      {title ? <PageHeader title={title} /> : null}
      <Card role="status">
        <CardContent className="flex flex-col items-center pb-10">
          <EmptyState
            icon={Unplug}
            title={i18n.t("未连接到 Host")}
            description={description ?? i18n.t("连接已断开或登录状态已失效，请重新登录后继续。")}
            className="pb-4"
          />
          <Button onClick={() => notifyAuthRequired()}>
            <LogIn />
            {i18n.t("重新登录")}
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  )
}
