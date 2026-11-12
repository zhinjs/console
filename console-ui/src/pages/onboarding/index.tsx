import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, Cable, CheckCircle2, Circle, Flag, MinusCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { useToast } from '../../components/toast'
import { useConsoleSession } from '../../hooks/use-console-session'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { currentOnboarding } from '../../utils/console-session.mjs'
import { nextOnboardingStep, onboardingComplete, type OnboardingFlowStep } from '../../utils/console-auth-model.mjs'
import { markOnboarding } from '../../utils/onboarding-store'
import { CONSOLE_PATHS as P } from '../../console-routes.mjs'
import type { OnboardingStepStatus } from '../../contracts/console-auth'
import { AdapterInstallSection } from './adapter-install'
import './onboarding.css'

/**
 * Onboarding after the owner exists (zhinjs/zhin ADR 0053 §2 steps 3–5): AI, adapters, finish.
 * Each step links to the pages that do the work; any step can be skipped and revisited.
 */
export default function OnboardingPage() {
  const i18n = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const session = useConsoleSession()
  const access = useConsoleAccess()
  const state = currentOnboarding(session)
  const [active, setActive] = useState<OnboardingFlowStep>(() => nextOnboardingStep(state))
  const [saving, setSaving] = useState(false)
  const [adapterReady, setAdapterReady] = useState(false)

  const canInstall = hasConsolePermission('plugin.manage', access)
  const statusOf = (step: OnboardingFlowStep): OnboardingStepStatus | 'complete' =>
    step === 'finish' ? (onboardingComplete(state) ? 'complete' : 'pending') : state?.steps?.[step] ?? 'pending'

  const mark = async (step: OnboardingFlowStep, status: OnboardingStepStatus) => {
    setSaving(true)
    const result = await markOnboarding(step, status)
    setSaving(false)
    if ('error' in result) {
      toast.error(result.error instanceof Error ? result.error.message : String(result.error), i18n.t('保存引导进度失败'))
      return false
    }
    if (step === 'finish') {
      navigate(P.dashboard)
      return true
    }
    setActive(step === 'ai' ? 'adapters' : 'finish')
    return true
  }

  const steps: Array<{ id: OnboardingFlowStep; label: string; icon: typeof Bot }> = [
    { id: 'ai', label: i18n.t('AI'), icon: Bot },
    { id: 'adapters', label: i18n.t('聊天平台'), icon: Cable },
    { id: 'finish', label: i18n.t('完成'), icon: Flag },
  ]
  const statusLabel = (status: ReturnType<typeof statusOf>) =>
    status === 'done' || status === 'complete' ? i18n.t('已完成') : status === 'skipped' ? i18n.t('已跳过') : i18n.t('待处理')
  const StatusIcon = ({ status }: { status: ReturnType<typeof statusOf> }) =>
    status === 'done' || status === 'complete' ? <CheckCircle2 aria-hidden="true" /> : status === 'skipped' ? <MinusCircle aria-hidden="true" /> : <Circle aria-hidden="true" />

  return <PageShell>
    <PageHeader title={i18n.t('开始使用')} description={i18n.t('机器人已经可以登录。接下来接入 AI 和聊天平台；每一步都可以跳过，以后从「功能」区随时设置。')}
      actions={<Button variant="ghost" onClick={() => navigate(P.dashboard)}>{i18n.t('以后再说')}</Button>} />

    {!state && <Alert><AlertDescription>{i18n.t('此 Host 没有记录引导进度。下面的步骤仍然可以按需完成。')}</AlertDescription></Alert>}
    {!canInstall && <Alert variant="warning"><AlertDescription>{i18n.t('当前身份没有安装插件的权限（plugin.manage），只能查看这些步骤。')}</AlertDescription></Alert>}

    <ol className="console-onboarding-steps" aria-label={i18n.t('引导步骤')}>
      {steps.map((step, index) => {
        const status = statusOf(step.id)
        return <li key={step.id}>
          <button type="button" className="console-onboarding-step" aria-current={active === step.id ? 'step' : undefined}
            data-status={status} onClick={() => setActive(step.id)}>
            <StatusIcon status={status} />
            <span>{i18n.t('第 {0} 步', [index + 1])} · {step.label}</span>
            <small>{statusLabel(status)}</small>
          </button>
        </li>
      })}
    </ol>

    {active === 'ai' && <Card>
      <CardHeader><CardTitle className="text-base">{i18n.t('接入 AI')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{i18n.t('如果要让机器人用大模型对话：先在插件市场安装 @zhin.js/agent 和所选模型服务的 SDK，再到「AI 与模型」添加第一个模型并测试。')}</p>
        <p className="text-muted-foreground">{i18n.t('不需要 AI 时可以跳过；机器人仍然可以运行命令和插件。')}</p>
        <div className="console-onboarding-links">
          <Button asChild variant="outline"><Link to={P.marketplace}>{i18n.t('打开插件市场')}</Link></Button>
          <Button asChild variant="outline"><Link to={P.ai}>{i18n.t('打开 AI 与模型')}</Link></Button>
        </div>
        <StepActions saving={saving} onDone={() => void mark('ai', 'done')} onSkip={() => void mark('ai', 'skipped')} />
      </CardContent>
    </Card>}

    {active === 'adapters' && <Card>
      <CardHeader><CardTitle className="text-base">{i18n.t('接入聊天平台')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{i18n.t('选择机器人要上线的平台（可以多选）：在插件市场安装适配器，再到「适配器」为每个平台添加第一个账号并测试上线。')}</p>
        <p className="text-muted-foreground">{i18n.t('暂时只想在 Console 里试聊，可以跳过这一步。')}</p>
        {canInstall && <AdapterInstallSection onAdapterReady={() => setAdapterReady(true)} />}
        {adapterReady && <p role="status" className="text-sm">{i18n.t('适配器已启用。可以到「查看聊天账号」确认账号上线，或继续安装其他平台。')}</p>}
        <div className="console-onboarding-links">
          <Button asChild variant="outline"><Link to={P.marketplace}>{i18n.t('打开插件市场')}</Link></Button>
          <Button asChild variant="outline"><Link to={P.scope}>{i18n.t('查看聊天账号')}</Link></Button>
        </div>
        <StepActions saving={saving} onDone={() => void mark('adapters', 'done')} onSkip={() => void mark('adapters', 'skipped')} />
      </CardContent>
    </Card>}

    {active === 'finish' && <Card>
      <CardHeader><CardTitle className="text-base">{i18n.t('完成引导')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="console-onboarding-summary">
          {steps.filter(step => step.id !== 'finish').map(step => <li key={step.id}>
            <StatusIcon status={statusOf(step.id)} /><span>{step.label}</span><small>{statusLabel(statusOf(step.id))}</small>
          </li>)}
        </ul>
        <p className="text-muted-foreground">{i18n.t('跳过的步骤以后可以在「功能 → AI 与模型」「功能 → 适配器」完成。')}</p>
        <div className="console-onboarding-actions">
          <Button disabled={saving} onClick={() => void mark('finish', 'done')}>{i18n.t('完成，进入首页')}</Button>
        </div>
      </CardContent>
    </Card>}
  </PageShell>
}

function StepActions({ saving, onDone, onSkip }: { saving: boolean; onDone: () => void; onSkip: () => void }) {
  const i18n = useI18n()
  return <div className="console-onboarding-actions">
    <Button variant="ghost" disabled={saving} onClick={onSkip}>{i18n.t('跳过')}</Button>
    <Button disabled={saving} onClick={onDone}>{i18n.t('已完成，下一步')}</Button>
  </div>
}
