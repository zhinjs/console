import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { useI18n } from '../i18n'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { pluginRpc } from '../utils/plugin-rpc'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import { AMBIENT_STATUS_PERMISSION, validateAmbientStatus, type AmbientStatus } from './ambient-engagement-model.mjs'
import { ambientJudgeDaily } from './inference/ambient-judge-model.mjs'

/**
 * 「机器人状态」的插话判断用量（zhinjs/zhin#1250 第 47 批）：最近 7 天每天判断了几次、失败几次、
 * 切到备用几次、用了多少 token。只给有 `ambient:read` 的身份看；实例不报告 `judgeDaily`
 * （旧版本）或读取失败时整块不显示，不当成「没有判断」。
 */
export function AmbientJudgeUsage() {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const allowed = hasConsolePermission(AMBIENT_STATUS_PERMISSION, access)
  const [status, setStatus] = useState<AmbientStatus | null>(null)
  useEffect(() => {
    if (!allowed) return
    let alive = true
    void pluginRpc<unknown>('root', 'ambient').then(
      (data) => { if (alive) setStatus(validateAmbientStatus(data, i18n.locale)) },
    ).catch(() => { if (alive) setStatus(null) })
    return () => { alive = false }
  }, [allowed])
  const daily = allowed ? ambientJudgeDaily(status, i18n.locale) : null
  if (!daily) return null
  const number = (value: number) => value.toLocaleString(i18n.locale === 'en' ? 'en-US' : 'zh-CN')
  return (
    <section className="console-dashboard-panel" aria-labelledby="ambient-judge-usage-title" data-ambient-judge-usage="">
      <div className="console-panel-heading">
        <div>
          <h2 id="ambient-judge-usage-title">{i18n.t("插话判断用量")}</h2>
          <p>
            {daily.timeZone
              ? i18n.t("最近 7 天，按实例时区 {0} 的日期统计；实例重启后当天重新计数。", [daily.timeZone])
              : i18n.t("最近 7 天；实例重启后当天重新计数。")}
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild><Link to={CONSOLE_PATHS.aiAmbient}>{i18n.t("群聊插话")}<ArrowUpRight /></Link></Button>
      </div>
      {daily.total.calls === 0 ? (
        <p className="text-sm text-muted-foreground">{i18n.t("最近 7 天还没有插话判断。")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{i18n.t("日期")}</TableHead>
                <TableHead className="text-right">{i18n.t("判断模型调用次数")}</TableHead>
                <TableHead className="text-right">{i18n.t("失败")}</TableHead>
                <TableHead className="text-right">{i18n.t("切到备用")}</TableHead>
                <TableHead className="text-right">{i18n.t("token 用量")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daily.rows.map((row) => row.known ? (
                <TableRow key={row.day}>
                  <TableCell><span title={row.day}>{row.label}</span></TableCell>
                  <TableCell className="text-right">{number(row.calls)}</TableCell>
                  <TableCell className="text-right">{number(row.failed)}</TableCell>
                  <TableCell className="text-right">{number(row.fallbacks)}</TableCell>
                  <TableCell className="text-right">
                    <span title={i18n.t("输入 {0} · 输出 {1} · 缓存读取 {2} · 缓存写入 {3}", [number(row.inputTokens), number(row.outputTokens), number(row.cacheReadTokens), number(row.cacheWriteTokens)])}>
                      {number(row.tokens)}
                    </span>
                    {row.unreportedCalls > 0 ? <span className="block text-xs text-muted-foreground">{i18n.t("{0} 次未回报", [row.unreportedCalls])}</span> : null}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.day} data-judge-day-unknown="">
                  <TableCell><span title={row.day}>{row.label}</span></TableCell>
                  <TableCell colSpan={4} className="text-right text-muted-foreground">{i18n.t("无数据")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {daily.total.calls > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground" role="note">{i18n.t("按判断模型的调用计数：开启对照时，每次判断计 2 次。")}</p>
      ) : null}
      {daily.total.calls > 0 && daily.rows.some(row => !row.known) ? (
        <p className="mt-1 text-xs text-muted-foreground" role="note" data-judge-unknown-note="">{i18n.t("实例版本较旧，没有报告实例当天的日期，这几天可能已被清理或还没到，不代表没有判断。")}</p>
      ) : null}
      {daily.unreported ? (
        <p className="mt-1 text-xs text-muted-foreground" role="note">{i18n.t("部分调用未回报用量，token 合计偏少。")}</p>
      ) : null}
    </section>
  )
}
