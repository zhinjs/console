import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useMemo, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { SelectField } from '../components/ui/select'
import { readScenario, readScenarioJson, readScenarioSegments, scenarioPreviewItems, scenarioMarkdownBlocks, scenarioExportIssues, scenarioJson, exportScenarioRegression, SCENARIO_PROFILES, type Scenario, type ScenarioTarget } from './scenario-lab/scenario-model.mjs'

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function parseJsonField(source: string, label: string, locale: 'zh-CN' | 'en' = 'zh-CN'): unknown {
  try { return JSON.parse(source) } catch { throw new Error(translate(locale, "{0} JSON 无效，请补全后再导出。", [label])) }
}
const initialTarget: ScenarioTarget = { endpoint: { id: 'example-source-account', adapter: 'example' }, kind: 'group', id: 'example-group' }

export default function ScenarioLabPage() {
  const i18n = useI18n()
  const [name, setName] = useState(i18n.t("我的消息场景"))
  const [target, setTarget] = useState<ScenarioTarget>(initialTarget)
  const [parentKind, setParentKind] = useState('')
  const [parentId, setParentId] = useState('')
  const [thread, setThread] = useState('')
  const [senderId, setSenderId] = useState('example-user')
  const [withName, setWithName] = useState(false)
  const [senderName, setSenderName] = useState('')
  const [withRoles, setWithRoles] = useState(false)
  const [roles, setRoles] = useState('[]')
  const [input, setInput] = useState('hello')
  const [output, setOutput] = useState(i18n.t("[\n  { \"type\": \"text\", \"data\": { \"text\": \"你好，这是一条作者预期消息。\" } }\n]"))
  const [profile, setProfile] = useState<'text' | 'rich'>('text')
  const [withFixture, setWithFixture] = useState(false)
  const [syntheticEndpoint, setSyntheticEndpoint] = useState('test')
  const [config, setConfig] = useState('{"configVersion":2}')
  const [withAssertions, setWithAssertions] = useState(false)
  const [status, setStatus] = useState('')
  const [deliveries, setDeliveries] = useState('')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const preview = useMemo(() => {
    try { return { items: scenarioPreviewItems(parseJsonField(output, i18n.t("作者预期输出"), i18n.locale), profile, i18n.locale), error: '' } }
    catch (error) { return { items: [], error: error instanceof Error ? error.message : i18n.t("输出 JSON 无效") } }
  }, [output, profile, i18n])
  const result = useMemo(() => {
    try {
      if (Boolean(parentKind) !== Boolean(parentId)) throw new Error(i18n.t("父容器类型和 ID 必须同时填写"))
      const sourceTarget = { ...target, ...(parentKind ? { parent: { kind: parentKind, id: parentId } } : {}), ...(thread ? { threadId: thread } : {}) }
      const scene = readScenario({ schemaVersion: 1, name, sourceTarget, sender: { id: senderId, ...(withName ? { name: senderName } : {}), ...(withRoles ? { roles: parseJsonField(roles, i18n.t("测试角色"), i18n.locale) } : {}) }, input, preview: readScenarioSegments(parseJsonField(output, i18n.t("作者预期输出"), i18n.locale), i18n.locale), profile,
        ...(withFixture ? { fixture: { syntheticEndpoint, config: parseJsonField(config, i18n.t("独立测试配置"), i18n.locale) } } : {}),
        ...(withAssertions ? { assertions: { dispatchStatus: status, deliveries: parseJsonField(deliveries, i18n.t("最终 payload 断言"), i18n.locale) } } : {}),
      }, i18n.locale)
      return { scene, error: '', issues: scenarioExportIssues(scene, i18n.locale) }
    } catch (error) { return { scene: null, error: error instanceof Error ? error.message : i18n.t("场景格式无效"), issues: [] } }
  }, [target, parentKind, parentId, thread, name, senderId, withName, senderName, withRoles, roles, input, output, profile, withFixture, syntheticEndpoint, config, withAssertions, status, deliveries, i18n])
  const exported = result.scene && !result.issues.length ? exportScenarioRegression(result.scene, i18n.locale) : null
  function load() {
    try {
      const scene: Scenario = readScenarioJson(importText, i18n.locale)
      setName(scene.name); setTarget({ endpoint: scene.sourceTarget.endpoint, kind: scene.sourceTarget.kind, id: scene.sourceTarget.id })
      setParentKind(scene.sourceTarget.parent?.kind ?? ''); setParentId(scene.sourceTarget.parent?.id ?? ''); setThread(scene.sourceTarget.threadId ?? '')
      setSenderId(scene.sender.id); setWithName(Object.hasOwn(scene.sender, 'name')); setSenderName(scene.sender.name ?? ''); setWithRoles(Object.hasOwn(scene.sender, 'roles')); setRoles(JSON.stringify(scene.sender.roles ?? []))
      setInput(scene.input); setOutput(JSON.stringify(scene.preview, null, 2)); setProfile(scene.profile)
      setWithFixture(Boolean(scene.fixture)); setSyntheticEndpoint(scene.fixture?.syntheticEndpoint ?? 'test'); setConfig(JSON.stringify(scene.fixture?.config ?? { configVersion: 2 }, null, 2))
      setWithAssertions(Boolean(scene.assertions)); setStatus(scene.assertions?.dispatchStatus ?? ''); setDeliveries(scene.assertions ? JSON.stringify(scene.assertions.deliveries, null, 2) : '')
      setImportError('')
    } catch (error) { setImportError(error instanceof Error ? error.message : i18n.t("导入失败")) }
  }
  return <div className="space-y-5 pb-6">
    <PageHeader title={i18n.t("消息场景试验台")} description={i18n.t("先预览作者预期消息，再导出可在独立测试项目显式运行的回归。")} />
    <Card className="space-y-2 p-4 text-sm"><p className="font-medium">{i18n.t("本地只读预览，不执行插件")}</p><p className="text-muted-foreground">{i18n.t("不读取当前 Host 配置，不发送或重放消息，不运行组件、业务工具或 Shotium，不注册交互。账号、发送者及角色都是你提供的测试场景；示例身份不代表真实登录。")}</p><p className="text-xs text-muted-foreground">{i18n.t("导出不等于执行通过；合成端点回归、浏览器外观与真实平台投递是不同证据。此页不保存草稿，离开前可导出场景 JSON；请勿填写凭据。")}</p></Card>
    <details className="rounded-md border p-4"><summary className="cursor-pointer text-sm font-medium">{i18n.t("导入已有场景 JSON")}</summary><div className="mt-3 space-y-3"><Textarea aria-label={i18n.t("导入场景 JSON")} className="min-h-32 font-mono text-xs" maxLength={96000} value={importText} onChange={e => setImportText(e.target.value)} /><Button variant="outline" onClick={load}>{i18n.t("读取本地场景")}</Button>{importError && <p role="alert">{importError}</p>}</div></details>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <div className="min-w-0 space-y-5">
        <Card className="space-y-4 p-4"><h2 className="font-semibold">{i18n.t("来源与输入")}</h2><Field label={i18n.t("场景名称")}><Input aria-label={i18n.t("场景名称")} value={name} maxLength={120} onChange={e => setName(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label={i18n.t("来源适配器标识")}><Input aria-label={i18n.t("来源适配器标识")} value={target.endpoint.adapter} onChange={e => setTarget(v => ({ ...v, endpoint: { ...v.endpoint, adapter: e.target.value } }))} /></Field><Field label={i18n.t("来源账号完整 ID")}><Input aria-label={i18n.t("来源账号完整 ID")} value={target.endpoint.id} onChange={e => setTarget(v => ({ ...v, endpoint: { ...v.endpoint, id: e.target.value } }))} /></Field></div>
          <p className="text-xs text-muted-foreground">{i18n.t("完整账号身份由你明确填写，昵称、裸账号 ID 不会自动补成真实 Endpoint。原始身份仅保留来源，不会成为执行/发送目标。")}</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label={i18n.t("来源会话类型")}><SelectField aria-label={i18n.t("来源会话类型")} value={target.kind} onValueChange={value => setTarget(v => ({ ...v, kind: value as ScenarioTarget['kind'] }))} options={[{ value: 'private', label: i18n.t("私聊") }, { value: 'group', label: i18n.t("群聊") }, { value: 'channel', label: i18n.t("频道") }]} /></Field><Field label={i18n.t("来源会话 ID")}><Input aria-label={i18n.t("来源会话 ID")} value={target.id} onChange={e => setTarget(v => ({ ...v, id: e.target.value }))} /></Field></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label={i18n.t("来源父容器类型")}><SelectField aria-label={i18n.t("来源父容器类型")} value={parentKind} onValueChange={setParentKind} options={[{ value: '', label: i18n.t("不提供") }, { value: 'private', label: i18n.t("私聊") }, { value: 'group', label: i18n.t("群聊") }, { value: 'channel', label: i18n.t("频道") }]} /></Field><Field label={i18n.t("来源父容器 ID")}><Input aria-label={i18n.t("来源父容器 ID")} value={parentId} onChange={e => setParentId(e.target.value)} /></Field></div>
          <Field label={i18n.t("来源话题 / 回复串 ID")}><Input aria-label={i18n.t("来源话题 / 回复串 ID")} value={thread} onChange={e => setThread(e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">{i18n.t("kind、ID、父容器和话题均原样保留；未填写不代表通配。")}</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label={i18n.t("发送者 ID")}><Input aria-label={i18n.t("发送者 ID")} value={senderId} onChange={e => setSenderId(e.target.value)} /></Field><Field label={i18n.t("发送者名称（可选）")}><label className="flex items-center gap-2 text-xs"><Checkbox checked={withName} onCheckedChange={checked => setWithName(checked === true)} />{i18n.t("提供发送者名称（允许为空）")}</label><Input aria-label={i18n.t("发送者名称（可选）")} disabled={!withName} value={senderName} onChange={e => setSenderName(e.target.value)} /></Field></div>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={withRoles} onCheckedChange={checked => setWithRoles(checked === true)} />{i18n.t("明确提供测试角色")}</label>{withRoles ? <Field label={i18n.t("测试角色 JSON 数组（[] 明确空角色）")}><Input aria-label={i18n.t("测试角色")} value={roles} onChange={e => setRoles(e.target.value)} /></Field> : <p className="text-xs text-muted-foreground">{i18n.t("未提供角色；与明确的空角色数组 [] 保持区别。")}</p>}
          <Field label={i18n.t("未来入站文本")}><Textarea aria-label={i18n.t("未来入站文本")} value={input} maxLength={16000} onChange={e => setInput(e.target.value)} /></Field><p className="text-xs text-muted-foreground">{i18n.t("仅为未来 PluginTestKit.receive 的输入，不会在此页派发。")}</p>
        </Card>
        <Card className="space-y-3 p-4"><h2 className="font-semibold">{i18n.t("作者预期输出")}</h2><p className="text-xs text-muted-foreground">{i18n.t("填写原生 JSON Segment[]；不接受 JSX / TSX 源码、函数、组件调用或 raw。预览不会推断实际插件输出。")}</p><Textarea aria-label={i18n.t("作者预期输出 JSON")} className="min-h-44 font-mono text-xs" value={output} maxLength={96000} onChange={e => setOutput(e.target.value)} /><Field label={i18n.t("测试能力配置")}><SelectField aria-label={i18n.t("测试能力配置")} value={profile} onValueChange={value => setProfile(value as 'text' | 'rich')} options={Object.entries(SCENARIO_PROFILES).map(([id, value]) => ({ value: id, label: i18n.t(value.title) }))} /></Field><p className="text-xs text-muted-foreground">{i18n.t("这是合成端点能力声明，不自动代表任何真实平台；图片引擎未启用，不提供虚假的图片/native 成功状态。")}</p></Card>
      </div>
      <div className="min-w-0 space-y-5">
        <ScenarioPreview items={preview.items} error={preview.error} />
        <Card className="space-y-3 p-4"><h2 className="font-semibold">{i18n.t("显式回归设置")}</h2><p className="text-xs text-muted-foreground">{i18n.t("可只导出场景 JSON。可执行文件必须有独立测试配置、合成账号映射及你明确编写的最终断言。没有远程运行按钮。")}</p>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={withFixture} onCheckedChange={checked => setWithFixture(checked === true)} />{i18n.t("我提供独立测试配置与账号映射")}</label>
          {withFixture && <><Field label={i18n.t("合成账号别名")}><Input aria-label={i18n.t("合成账号别名")} value={syntheticEndpoint} onChange={e => setSyntheticEndpoint(e.target.value)} /></Field><p className="break-all text-xs text-muted-foreground">{i18n.t("来源账号 ")}{JSON.stringify(target.endpoint)} {i18n.t(" → 合成别名 ")}{syntheticEndpoint || i18n.t("待填写")}{i18n.t("。执行使用新的测试 Endpoint，完整来源不会冒认为真实账号。")}</p><Field label={i18n.t("独立测试配置 JSON")}><Textarea aria-label={i18n.t("独立测试配置 JSON")} className="min-h-28 font-mono text-xs" value={config} maxLength={64000} onChange={e => setConfig(e.target.value)} /></Field></>}
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={withAssertions} onCheckedChange={checked => setWithAssertions(checked === true)} />{i18n.t("我单独编写最终派发与投递断言")}</label>
          {withAssertions && <><Field label={i18n.t("预期派发状态")}><SelectField aria-label={i18n.t("预期派发状态")} value={status} onValueChange={setStatus} options={[{ value: '', label: i18n.t("请选择") }, { value: 'executed', label: i18n.t("指令已执行") }, { value: 'invalid', label: i18n.t("参数无效") }, { value: 'denied', label: i18n.t("权限拒绝") }, { value: 'unmatched', label: i18n.t("未匹配指令") }, { value: 'limited', label: i18n.t("准入限制（需支持此状态的 Runtime）") }]} /></Field><Field label={i18n.t("最终 payload 数组 JSON")}><Textarea aria-label={i18n.t("最终 payload 数组 JSON")} className="min-h-32 font-mono text-xs" value={deliveries} maxLength={64000} onChange={e => setDeliveries(e.target.value)} /></Field><p className="text-xs text-muted-foreground">{i18n.t("每项是一条最终 payload（字符串或原生消息段数组）；[] 明确断言没有投递。首版要求全部输出投递到来源会话映射后的合成账号，跨会话主动发送请另写测试。不会把上方浏览器预览自动复制为断言。")}</p></>}
          <p className="text-xs text-muted-foreground">{i18n.t("运行时必须显式指定 ZHIN_SCENARIO_FIXTURE_ROOT 的绝对路径。测试项目内的依赖、插件和 config 由开发者准备；不会自动安装、读取当前生产配置或执行。")}</p>
          <p className="text-xs text-amber-700">{i18n.t("PluginTestKit 不是安全沙箱：插件 import/setup 可访问文件、网络或启动适配器。只运行可信、无生产凭据的独立测试项目。")}</p>
          {result.error && <p role="alert" className="break-words text-sm text-destructive">{i18n.t("场景尚不完整：")}{result.error}</p>}{result.issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!result.scene} onClick={() => result.scene && download('scenario.json', scenarioJson(result.scene, i18n.locale))}><Download className="mr-1 h-4 w-4" />{i18n.t("导出场景 JSON")}</Button><Button disabled={!exported} onClick={() => exported && download('scenario.test.mjs', exported.testSource)}>{i18n.t("导出回归文件")}</Button><Button variant="outline" disabled={!exported} onClick={() => exported && download('README.md', exported.readme)}>{i18n.t("导出运行说明")}</Button></div>
        </Card>
        {result.scene && <details className="rounded-md border p-4"><summary className="cursor-pointer text-sm">{i18n.t("完整场景与身份")}</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{scenarioJson(result.scene, i18n.locale)}</pre></details>}
      </div>
    </div>
  </div>
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="min-w-0 space-y-1.5"><p className="text-sm font-medium">{label}</p>{children}</div> }
export function ScenarioPreview({ items, error }: { items: ReturnType<typeof scenarioPreviewItems>; error: string }) {
  const i18n = useI18n()
  return <Card className="space-y-3 p-4" role="region" aria-label={i18n.t("作者预期消息预览")}><h2 className="font-semibold">{i18n.t("预期消息外观")}</h2><p className="text-xs text-muted-foreground">{i18n.t("文字直接显示；Markdown 子集可读展示；HTML 源文与媒体占位不等于平台渲染结果。按钮不可操作，不产生网络请求。")}</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !items.length ? <p className="text-sm text-muted-foreground">{i18n.t("作者预期没有输出。")}</p> : <div className="space-y-3 rounded-lg bg-muted/40 p-3">{items.map((item, index) => <div key={index} className="min-w-0 space-y-2 rounded-md border bg-background p-3">{item.label && <p className="text-xs text-muted-foreground">{item.label}</p>}{item.kind === 'buttons' ? <button type="button" disabled className="rounded-md border px-3 py-2 text-sm opacity-60">{item.text}{i18n.t("（已禁用）")}</button> : item.kind === 'markdown' ? <ScenarioMarkdown source={item.text} /> : item.kind === 'source' ? <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{item.text}</pre> : <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>}</div>)}</div>}</Card>
}

export function ScenarioMarkdown({ source }: { source: string }) {
  const i18n = useI18n()
  return <div className="space-y-3 text-sm" aria-label={i18n.t("Markdown 子集预览")}>{scenarioMarkdownBlocks(source, i18n.locale).map((block, index) => {
    if (block.kind === 'code') return <div key={index} className="overflow-hidden rounded-md border"><div className="bg-muted px-3 py-1 text-xs text-muted-foreground">{block.language || i18n.t("代码")}</div><pre className="overflow-auto bg-slate-950 p-3 text-xs text-slate-100"><code>{block.text}</code></pre></div>
    if (block.kind === 'heading') return <p key={index} role="heading" aria-level={block.level} className={block.level === 1 ? 'text-lg font-semibold' : 'font-semibold'}>{block.text}</p>
    if (block.kind === 'list') return block.ordered ? <ol key={index} className="list-decimal space-y-1 pl-5">{block.items?.map((item, i) => <li key={i}>{item}</li>)}</ol> : <ul key={index} className="list-disc space-y-1 pl-5">{block.items?.map((item, i) => <li key={i}>{item}</li>)}</ul>
    if (block.kind === 'quote') return <blockquote key={index} className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">{block.text}</blockquote>
    if (block.kind === 'table') return <div key={index} className="max-w-full overflow-auto"><table className="w-full border-collapse text-xs"><thead><tr>{block.rows?.[0].map((cell, i) => <th key={i} className="border bg-muted p-2 text-left">{cell}</th>)}</tr></thead><tbody>{block.rows?.slice(1).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="border p-2">{cell}</td>)}</tr>)}</tbody></table></div>
    if (block.kind === 'source') return <div key={index}><p className="text-xs text-muted-foreground">{block.label}</p><pre className="whitespace-pre-wrap break-all text-xs">{block.text}</pre></div>
    return <p key={index} className="whitespace-pre-wrap break-words">{block.text}</p>
  })}</div>
}
