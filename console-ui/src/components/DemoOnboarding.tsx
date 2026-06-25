import { useCallback, useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  isDemoOnboardingDone,
  setDemoOnboardingDone,
} from '../utils/demo-onboarding'

const STEPS = [
  {
    title: '零安装体验 Zhin',
    body: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed">
          你已连接到官方托管 Sandbox（<code className="text-xs bg-muted px-1 rounded">demo-api.zhin.dev</code>
          ），无需 API Base / Token。
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">
          <strong>QQ 群助手 + 可选 @AI</strong> — 先在 Demo 里玩通，再部署到本机或接 QQ。
        </p>
      </>
    ),
  },
  {
    title: '试试 hello 与 card',
    body: (
      <>
        <p className="text-sm text-muted-foreground mb-2">在侧栏打开 <strong>沙盒</strong>，依次发送：</p>
        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
          <li>
            <code className="text-xs bg-muted px-1 rounded">hello</code> — 命令 Bot 回复
          </li>
          <li>
            <code className="text-xs bg-muted px-1 rounded">card</code> — JSX 状态卡片
          </li>
          <li>
            <code className="text-xs bg-muted px-1 rounded">ai: 你好</code> — Agent 对话（Demo 已启用 Ollama）
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '下一步（任选）',
    body: (
      <div className="flex flex-col gap-2">
        <a
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium h-10 px-4"
          href="https://zhin.js.org/getting-started/first-run"
          target="_blank"
          rel="noopener noreferrer"
        >
          部署到本机 · npm create zhin-app
        </a>
        <a
          className="inline-flex items-center justify-center rounded-md border border-primary text-primary text-sm font-medium h-10 px-4"
          href="https://zhin.js.org/adapters/icqq"
          target="_blank"
          rel="noopener noreferrer"
        >
          接 QQ Bot · ICQQ 适配器
        </a>
      </div>
    ),
  },
] as const

export function DemoOnboardingGate({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(() => !isDemoOnboardingDone())
  const [step, setStep] = useState(0)

  const close = useCallback(() => {
    setDemoOnboardingDone()
    setOpen(false)
  }, [])

  if (!open) return <>{children}</>

  const current = STEPS[step]
  const isLast = step >= STEPS.length - 1

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-onboard-title"
      >
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              使用说明 · {step + 1} / {STEPS.length}
            </p>
            <CardTitle id="demo-onboard-title" className="text-lg">
              {current.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>{current.body}</div>
            <div className="flex flex-wrap gap-2">
            {step > 0 && (
              <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                上一步
              </Button>
            )}
            {!isLast ? (
              <>
                <Button type="button" className="flex-1" onClick={() => setStep((s) => s + 1)}>
                  下一步
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
                  跳过
                </Button>
              </>
            ) : (
              <Button type="button" className="flex-1" onClick={close}>
                开始体验
              </Button>
            )}
          </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

/** 顶栏「使用说明」重开 onboarding（不清除 Demo Token） */
export function reopenDemoOnboarding(): void {
  try {
    localStorage.removeItem('zhin_demo_onboarding_done')
  } catch {
    /* ignore */
  }
  window.location.reload()
}
