import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Copy, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, InlineCode, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { StatusState } from '../../components/StatusState'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { copyText } from '../clipboard-copy.mjs'
import {
  GATEWAY_VERSION_CHECK_RPC, VERSION_MIGRATE_COMMAND, migrateDocsHref, readVersionReport, reportedVersion, versionNotice, versionCheckUnsupported, versionRows, versionStateLabel,
  versionStateTone, type GatewayVersionReportView,
} from './gateway-model.mjs'
import { INSTANCE_SECTION_IDS, instanceSectionHref } from './instance-sections.mjs'
import { CONSOLE_PATHS } from '../../console-routes.mjs'
import { useGatewayRead } from './use-gateway'

const readReport = (value: unknown) => readVersionReport(value)

/**
 * `gateway.version.check` (zhinjs/console#64): answered by the gateway from its ~6 h cache. On a Host
 * without it `unsupported` is true and callers show nothing.
 */
export function useVersionCheck(enabled: boolean) {
  const read = useGatewayRead<GatewayVersionReportView | null>(GATEWAY_VERSION_CHECK_RPC, readReport, null, { enabled })
  return { ...read, unsupported: versionCheckUnsupported(read.failure) }
}

/**
 * 运维 → 实例 → 版本: current and latest versions of Zhin, the gateway, the Console packages and the
 * installed `@zhin.js/*` plugins. In-range releases point to 项目依赖's 更新; anything outside the
 * declared range only shows `npx zhin migrate --dry-run` — the Console never upgrades the framework (ADR 0062).
 */
export function VersionSection({ canUpdate }: { canUpdate: boolean }) {
  const i18n = useI18n()
  const check = useVersionCheck(true)
  if (check.unsupported) return null
  const report = check.data
  const rows = versionRows(report, i18n.t)
  const migrate = rows.some(row => row.state === 'migrate')
  const updatable = canUpdate && rows.some(row => row.update)
  const checkedAt = report?.checkedAt ? i18n.date(report.checkedAt, { dateStyle: 'medium', timeStyle: 'short' }) : null
  return (
    <div id={INSTANCE_SECTION_IDS.versions} className="scroll-mt-4">
      <ObjectSection title={i18n.t("版本")}
        description={i18n.t("网关按项目的 npm 配置查询最新版本，约每 6 小时检查一次。框架升级只通过命令行的 zhin migrate 完成。")}
        actions={<Button size="sm" variant="outline" onClick={check.refresh} disabled={check.loading}><RefreshCw className={check.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}>
        {check.error ? <StatusState compact error={check.failure ?? check.error} permissions={['status.view']} onRetry={check.refresh} /> : null}
        {!check.loaded && check.loading ? <StatusState kind="loading" placeholder={<Skeleton className="h-24" />} /> : null}
        {report && !report.registryReachable ? (
          <p className="console-admin-note" role="status">{i18n.t("无法检查新版本：网关连不上 npm registry（离线或超时）。下面只显示当前版本。")}</p>
        ) : null}
        {migrate ? <MigrateHint /> : null}
        {report && rows.length ? (
          <Card className="overflow-hidden p-0">
            <Table aria-label={i18n.t("版本")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18n.t("组件")}</TableHead>
                  <TableHead>{i18n.t("当前 → 最新")}</TableHead>
                  <TableHead>{i18n.t("状态")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.name}>
                    {/* Card mode (narrow): the name heads the card instead of a 组件 label. */}
                    <TableCell className="min-w-0 text-left" label="">
                      <div className="w-full min-w-0">
                        <span className="block text-sm font-medium">{row.label}</span>
                        <InlineCode tone="plain" className="block break-all text-xs text-muted-foreground">{row.name}{row.range ? ` · ${row.range}` : ''}</InlineCode>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <span>
                        {row.installed ?? '—'}<span className="px-1 text-muted-foreground" aria-hidden="true">→</span>
                        <span className="sr-only">{i18n.t("最新")} </span>{row.latest ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge size="sm" variant={versionStateTone(row.state)}>{versionStateLabel(row.state, i18n.t)}</Badge>
                        {row.update && row.wanted ? (
                          <span className="text-xs text-muted-foreground">{i18n.t("范围内可更新到 {0}", [row.wanted])}</span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : report && !rows.length ? (
          <StatusState kind="empty" compact title={i18n.t("没有可检查的 Zhin 包")} description={i18n.t("package.json 里没有声明 zhin.js 或 @zhin.js 插件。")} />
        ) : null}
        {updatable ? (
          <p className="text-xs text-muted-foreground">
            {i18n.t("声明范围内的新版本：在下方「项目依赖」里点该行的「更新」。")}{' '}
            <a className="underline underline-offset-2" href={`#${INSTANCE_SECTION_IDS.dependencies}`}>{i18n.t("前往项目依赖")}</a>
          </p>
        ) : null}
        {checkedAt ? <p className="text-xs text-muted-foreground">{i18n.t("检查于 {0}", [checkedAt])}</p> : null}
      </ObjectSection>
    </div>
  )
}

/** Upgrades outside the declared range: the command only, never a button (ADR 0062). */
function MigrateHint() {
  const i18n = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void copyText(VERSION_MIGRATE_COMMAND, navigator.clipboard, document).then(ok => {
      setCopied(ok)
      if (ok) window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Alert variant="warning">
      <AlertTitle>{i18n.t("有新的大版本或需要调整版本范围")}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{i18n.t("这类升级会修改 package.json 的版本范围并可能运行迁移，Console 不会代为执行。请在项目目录先预览：")}</p>
        <div className="flex min-w-0 items-center gap-2">
          <InlineCode className="min-w-0 flex-1 break-all px-2 py-1 text-xs">{VERSION_MIGRATE_COMMAND}</InlineCode>
          <Button size="sm" variant="outline" onClick={copy} aria-label={copied ? i18n.t("已复制") : i18n.t("复制命令")}>
            {copied ? <Check /> : <Copy />}{copied ? i18n.t("已复制") : i18n.t("复制")}
          </Button>
        </div>
        <p className="text-xs">
          {i18n.t("确认无误后去掉 --dry-run 执行。")}{' '}
          <a className="inline-flex items-center gap-0.5 underline underline-offset-2" href={migrateDocsHref(i18n.locale)} target="_blank" rel="noreferrer">
            {i18n.t("zhin migrate 文档")}<ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * The light global hint on 首页「进程与资源」: the running Zhin version and, when anything is newer,
 * a link to 运维 → 实例 → 版本. Nothing on a Host without the check, without `status.view`, or when
 * the check failed (an unreachable registry is not alarming).
 */
export function VersionHintRow({ enabled }: { enabled: boolean }) {
  const i18n = useI18n()
  const check = useVersionCheck(enabled)
  if (!enabled || check.unsupported || !check.data) return null
  const version = reportedVersion(check.data, 'zhin.js')
  const notice = versionNotice(check.data)
  if (!version && notice.kind === 'none') return null
  return (
    <div>
      <dt>{i18n.t("Zhin 版本")}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-2">
        <span className="font-mono">{version ?? '—'}</span>
        {notice.kind !== 'none' ? (
          <Link to={instanceSectionHref('versions', CONSOLE_PATHS.opsInstance)} className="console-soft-badge">
            {i18n.t("{0} 个包有新版本", [notice.count])}
          </Link>
        ) : null}
      </dd>
    </div>
  )
}
