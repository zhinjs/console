import { translate } from '../../i18n/locale.mjs'
/** Browser-only scenario contract. No Host calls, module loading or implicit execution. */
export const SCENARIO_PROFILES = Object.freeze({
  text: Object.freeze({ title: '纯文本端点（测试能力）', policy: Object.freeze({ html: 'text', markdown: 'text', interactive: 'text', outboundMedia: ['url'] }) }),
  rich: Object.freeze({ title: 'HTML / Markdown 保留（测试能力）', policy: Object.freeze({ html: 'direct', markdown: 'native', interactive: 'native', outboundMedia: ['base64', 'url'] }) }),
})
const kinds = ['private', 'group', 'channel']
const statuses = ['executed', 'invalid', 'denied', 'unmatched', 'limited']
const segmentTypes = new Set(['text', 'markdown', 'html', 'mention', 'image', 'audio', 'voice', 'video', 'file', 'face', 'link', 'share', 'reply', 'forward', 'keyboard', 'qrcode', 'tts', 'dice', 'rps'])
const own = (object, key) => Object.hasOwn(object, key)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function fail(message) { throw new Error(message) }
function text(value, label, max = 2048, locale = 'zh-CN') { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(translate(locale, "{0}必须是非空文本，且不超过 {1} 字符", [label, max])); return value }
function keys(value, allowed, label, locale = 'zh-CN') { if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(translate(locale, "{0}格式无效或包含不支持的字段", [label])) }
function jsonValue(value, locale = 'zh-CN') {
  let nodes = 0
  const visit = (item, depth) => {
    if (++nodes > 6000 || depth > 16) fail(translate(locale, "场景过大或嵌套超过上限"))
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail(translate(locale, "场景仅支持有限数字")); return }
    if (typeof item === 'string') { if (item.length > 32_000) fail(translate(locale, "单项文本超过 32000 字符")); return }
    if (Array.isArray(item)) { item.forEach(v => visit(v, depth + 1)); return }
    if (!record(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail(translate(locale, "场景仅支持 JSON，不支持函数、组件、流或对象实例"))
    for (const [key, child] of Object.entries(item)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(translate(locale, "场景包含不安全的对象键")); visit(child, depth + 1) }
  }
  visit(value, 0)
  if (JSON.stringify(value).length > 96_000) fail(translate(locale, "场景超过 96KB 字符上限"))
  return structuredClone(value)
}
export function readScenarioTarget(value, locale = 'zh-CN') {
  keys(value, ['endpoint', 'kind', 'id', 'parent', 'threadId'], translate(locale, "来源会话"), locale)
  keys(value.endpoint, ['id', 'adapter'], translate(locale, "完整账号身份"), locale)
  text(value.endpoint.id, translate(locale, "账号完整 ID"), undefined, locale); text(value.endpoint.adapter, translate(locale, "适配器标识"), undefined, locale)
  if (!kinds.includes(value.kind)) fail(translate(locale, "会话类型必须为 private、group 或 channel"))
  text(value.id, translate(locale, "会话 ID"), undefined, locale)
  if (own(value, 'parent')) { keys(value.parent, ['kind', 'id'], translate(locale, "父容器"), locale); if (!kinds.includes(value.parent.kind)) fail(translate(locale, "父容器类型无效")); text(value.parent.id, translate(locale, "父容器 ID"), undefined, locale) }
  if (own(value, 'threadId')) text(value.threadId, translate(locale, "话题 ID"), undefined, locale)
  return jsonValue(value, locale)
}
export function readScenarioSegments(value, locale = 'zh-CN') {
  if (!Array.isArray(value) || value.length > 64) fail(translate(locale, "预期输出须为最多 64 项的原生 Segment 数组"))
  for (const item of value) {
    keys(item, ['type', 'data'], translate(locale, "消息段"), locale)
    if (!segmentTypes.has(item.type) || !record(item.data)) fail(translate(locale, "仅支持原生 JSON 消息段；不支持组件调用、raw、JSX 源码或函数"))
    if (item.type === 'text' && typeof item.data.text !== 'string') fail(translate(locale, "text 段须有 data.text"))
    if (item.type === 'html' && typeof item.data.html !== 'string') fail(translate(locale, "html 段须有 data.html"))
    if (item.type === 'markdown' && typeof (item.data.content ?? item.data.text) !== 'string') fail(translate(locale, "markdown 段须有 data.content 或 data.text"))
  }
  return jsonValue(value, locale)
}
export function readScenario(value, locale = 'zh-CN') {
  keys(value, ['schemaVersion', 'name', 'sourceTarget', 'sender', 'input', 'preview', 'profile', 'fixture', 'assertions'], translate(locale, "场景"), locale)
  if (value.schemaVersion !== 1) fail(translate(locale, "不支持的场景版本"))
  text(value.name, translate(locale, "场景名称"), 120, locale); readScenarioTarget(value.sourceTarget, locale)
  keys(value.sender, ['id', 'name', 'roles'], translate(locale, "发送者"), locale); text(value.sender.id, translate(locale, "发送者 ID"), undefined, locale)
  if (own(value.sender, 'name') && typeof value.sender.name !== 'string') fail(translate(locale, "发送者名称须为文本"))
  if (own(value.sender, 'roles') && (!Array.isArray(value.sender.roles) || value.sender.roles.length > 32 || value.sender.roles.some(role => typeof role !== 'string' || !role.trim() || role.length > 160))) fail(translate(locale, "角色须为最多 32 项的非空文本数组；不填与 [] 含义不同"))
  if (typeof value.input !== 'string' || value.input.length > 16_000) fail(translate(locale, "未来入站文本须不超过 16000 字符"))
  readScenarioSegments(value.preview, locale)
  if (!own(SCENARIO_PROFILES, value.profile)) fail(translate(locale, "请选择明确的测试能力配置"))
  if (own(value, 'fixture')) {
    keys(value.fixture, ['syntheticEndpoint', 'config'], translate(locale, "测试项目配置"), locale)
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(value.fixture.syntheticEndpoint)) fail(translate(locale, "合成账号别名须为小写英文、数字或连字符，以字母开头"))
    if (!record(value.fixture.config) || value.fixture.config.configVersion !== 2) fail(translate(locale, "须明确提供 configVersion: 2 的独立测试配置"))
  }
  if (own(value, 'assertions')) {
    keys(value.assertions, ['dispatchStatus', 'deliveries'], translate(locale, "回归断言"), locale)
    if (!statuses.includes(value.assertions.dispatchStatus)) fail(translate(locale, "须明确选择预期派发状态"))
    if (!Array.isArray(value.assertions.deliveries) || value.assertions.deliveries.length > 32) fail(translate(locale, "须明确提供最终 payload 数组；[] 明确断言没有投递，最多 32 条"))
    value.assertions.deliveries.forEach(payload => {
      if (typeof payload !== 'string') readScenarioSegments(payload, locale)
    })
  }
  return jsonValue(value, locale)
}
export function readScenarioJson(source, locale = 'zh-CN') {
  if (typeof source !== 'string' || source.length > 96_000) fail(translate(locale, "场景 JSON 超过上限"))
  let value; try { value = JSON.parse(source) } catch { fail(translate(locale, "场景 JSON 无效")) }
  return readScenario(value, locale)
}
export function scenarioExportIssues(value, locale = 'zh-CN') {
  try {
    const scene = readScenario(value, locale), issues = []
    if (!scene.fixture) issues.push(translate(locale, "明确独立测试配置与来源账号到合成账号的映射"))
    if (!scene.assertions) issues.push(translate(locale, "明确派发状态及最终 payload 断言（不是浏览器预览推断）"))
    if (!scene.input.trim()) issues.push(translate(locale, "填写用于真实 receive 的入站文本"))
    return issues
  } catch (error) { return [error.message] }
}
export function scenarioJson(value, locale = 'zh-CN') { return JSON.stringify(readScenario(value, locale), null, 2) + '\n' }
export function exportScenarioRegression(value, locale = 'zh-CN') {
  const scene = readScenario(value, locale), issues = scenarioExportIssues(scene, locale)
  if (issues.length) fail(translate(locale, "暂不能导出可执行回归：{0}", [issues.join('；')]))
  const testSource = `// Generated by Zhin Console scenario-lab v1. Trusted independent fixture only; NOT a sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { PluginTestKit } from '@zhin.js/testing';
import { capabilityId, rootPluginId } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
const scenario = JSON.parse(await readFile(new URL('./scenario.json', import.meta.url), 'utf8'));
const policies = ${JSON.stringify(Object.fromEntries(Object.entries(SCENARIO_PROFILES).map(([id, value]) => [id, value.policy])))};
assert.equal(scenario.schemaVersion, 1, 'Unsupported scenario version');
assert.ok(Object.hasOwn(policies, scenario.profile), 'Unknown synthetic endpoint profile');
assert.ok(scenario.fixture && scenario.fixture.config?.configVersion === 2, 'Explicit test config required');
assert.ok(scenario.assertions && ['executed','invalid','denied','unmatched','limited'].includes(scenario.assertions.dispatchStatus) && Array.isArray(scenario.assertions.deliveries), 'Explicit dispatch and delivery assertions required');
const fixtureRoot = process.env.ZHIN_SCENARIO_FIXTURE_ROOT;
assert.ok(fixtureRoot && isAbsolute(fixtureRoot), 'Set ZHIN_SCENARIO_FIXTURE_ROOT to an absolute, trusted, independent test application path. Never use a production application.');
test(scenario.name, { timeout: 15000 }, async () => {
  const kit = await PluginTestKit.create({ projectRoot: fixtureRoot, config: scenario.fixture.config,
    endpoints: [scenario.fixture.syntheticEndpoint], segments: policies[scenario.profile] });
  try {
    await kit.start();
    const address = { ...scenario.sourceTarget }; delete address.endpoint;
    // Explicit source-to-synthetic mapping. The production endpoint is provenance, never an execution target.
    const effectiveEndpoint = { id: capabilityId(rootPluginId(), adapterFeatureId, scenario.fixture.syntheticEndpoint), adapter: scenario.fixture.syntheticEndpoint };
    const result = await kit.receive({ endpoint: scenario.fixture.syntheticEndpoint, conversation: address, sender: scenario.sender, content: scenario.input });
    if (scenario.assertions.dispatchStatus === 'unmatched') {
      assert.equal(result?.matched, false, 'unmatched route');
      assert.ok(result.status === undefined || result.status === 'unmatched', 'unmatched dispatch status');
    } else {
      assert.equal(result?.status, scenario.assertions.dispatchStatus, 'dispatch status');
    }
    assert.deepEqual(kit.deliveries.map(({ conversation, payload }) => ({ conversation, payload })),
      scenario.assertions.deliveries.map(payload => ({ conversation: { ...address, endpoint: effectiveEndpoint }, payload })), 'exact target and final payloads');
  } finally { await kit.close(); }
});
`
  const readme = translate(locale, "# {0}\n\n此文件由 Console 生成，尚未证明你的插件通过测试。scenario.json 中的 preview 是作者预期外观；assertions 是作者单独填写的最终派发/投递断言。\n\n## 显式运行\n\n准备独立、可信的测试项目及它实际需要的依赖和插件，安装开发依赖 @zhin.js/testing、@zhin.js/plugin-runtime、@zhin.js/adapter 与 tsx；导出不会自动安装或运行。将这三个文件放进该测试项目中，再执行：\n\nZHIN_SCENARIO_FIXTURE_ROOT=/absolute/path/to/test-app node --conditions=development --import tsx --test scenario.test.mjs\n\n必须显式提供绝对路径，无 cwd 或生产配置回退。测试配置来自 scenario.fixture.config，账号 {1} 显式映射为合成别名 {2}；kind/id/parent/thread 和发送者完整保留。首版断言所有最终投递均指向该原会话的合成账号映射，跨会话主动发送应另写测试。\n\nPluginTestKit 运行真实模块 import/setup/指令/中间件并记录合成端点最终载荷；它不是安全沙箱。独立数据目录与无凭据配置不能阻止代码访问宿主文件或联网。只运行可信 fixture，勿挂载真实适配器、生产配置、数据库或凭据；不要在生产 Host 运行此文件。limited 断言需要支持该准入状态的 Runtime。角色是测试假设，非平台权限证明；HTML direct/native 仅表示测试能力，不证明真实平台外观或投递。\n\n## 证据边界\n\n导出 ≠ 执行通过；合成端点 Runtime 回归 ≠ 浏览器截图 ≠ 真实平台发送。检查失败时核对明确断言，不要自动重放生产消息。\n", [scene.name, JSON.stringify(scene.sourceTarget.endpoint), JSON.stringify(scene.fixture.syntheticEndpoint)])
  return { scenarioJson: scenarioJson(scene, locale), testSource, readme }
}
/** No HTML interpretation: preview returns safe descriptions for non-text forms. */
export function scenarioPreviewItems(value, profile, locale = 'zh-CN') {
  const segments = readScenarioSegments(value, locale)
  if (!own(SCENARIO_PROFILES, profile)) fail(translate(locale, "测试能力配置无效"))
  return segments.map(segment => {
    const data = segment.data
    if (segment.type === 'text') return { kind: 'text', text: data.text }
    if (segment.type === 'mention') return { kind: 'text', text: `@${typeof data.name === 'string' ? data.name : typeof data.target === 'string' ? data.target : translate(locale, "提及用户")}` }
    if (['link', 'share'].includes(segment.type)) return { kind: 'text', text: [data.title ?? data.text, data.url].filter(value => typeof value === 'string').join(' · ') || translate(locale, "链接（仅文本，不打开）") }
    if (segment.type === 'face') return { kind: 'text', text: translate(locale, "表情：{0}", [typeof data.name === 'string' ? data.name : data.id ?? translate(locale, "未命名")]) }
    if (segment.type === 'markdown') return { kind: 'markdown', label: profile === 'text' ? translate(locale, "Markdown 可读预览；该测试端点的最终文本需回归断言核对") : translate(locale, "Markdown 子集预览（不等于平台原生外观）"), text: data.content ?? data.text }
    if (segment.type === 'html') return { kind: 'source', label: profile === 'text' ? translate(locale, "HTML：此测试端点要求降为文本；此处不运行 Host 转换") : translate(locale, "HTML 源文（未调用 Shotium / 组件渲染）"), text: data.html }
    if (segment.type === 'keyboard') return { kind: 'buttons', label: profile === 'text' ? translate(locale, "按钮文本占位；最终编号/回调不在预览中生成") : translate(locale, "按钮展示，不注册交互"), text: (Array.isArray(data.rows) ? data.rows.flat().map(button => typeof button?.label === 'string' ? button.label : translate(locale, "按钮")).slice(0, 32).join(' / ') : '') || translate(locale, "交互已禁用") }
    return { kind: 'placeholder', label: translate(locale, "{0} 消息段", [segment.type]), text: translate(locale, "安全占位：不读取本地媒体、不请求远程资源、不执行操作") }
  })
}
/** Small text-only Markdown subset, rendered as React text nodes by the UI. */
export function scenarioMarkdownBlocks(source, locale = 'zh-CN') {
  if (typeof source !== 'string' || source.length > 32_000) fail(translate(locale, "Markdown 超过 32000 字符"))
  const lines = source.replace(/\r\n/gu, '\n').split('\n'), blocks = []
  const special = line => /^(?:#{1,6} |\s*[-*+] |\s*\d+[.)] |> |`{3,}|~{3,})/u.test(line)
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue }
    const fence = lines[i].match(/^(`{3,}|~{3,})([^`]*)$/u)
    if (fence) {
      const body = [], language = fence[2].trim(); i++
      while (i < lines.length && !(lines[i][0] === fence[1][0] && new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`, 'u').test(lines[i]))) body.push(lines[i++])
      const closed = i < lines.length; if (closed) i++
      blocks.push({ kind: closed ? 'code' : 'source', text: body.join('\n'), language, label: closed ? undefined : translate(locale, "代码围栏未闭合，按源码展示") }); continue
    }
    const heading = lines[i].match(/^(#{1,6}) (.*)$/u)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); i++; continue }
    const cellRow = line => line.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim())
    if (i + 1 < lines.length && lines[i].includes('|') && cellRow(lines[i + 1]).every(cell => /^:?-{3,}:?$/u.test(cell))) {
      const rows = [cellRow(lines[i])]; i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cellRow(lines[i++]))
      blocks.push({ kind: 'table', rows }); continue
    }
    if (/^(?:[-*+] |\d+[.)] )/u.test(lines[i])) {
      const ordered = /^\d/u.test(lines[i]), items = []
      const pattern = ordered ? /^\d+[.)] (.*)$/u : /^[-*+] (.*)$/u
      while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, '$1'))
      blocks.push({ kind: 'list', ordered, items }); continue
    }
    if (lines[i].startsWith('> ')) {
      const body = []; while (i < lines.length && lines[i].startsWith('> ')) body.push(lines[i++].slice(2))
      blocks.push({ kind: 'quote', text: body.join('\n') }); continue
    }
    const body = [lines[i++]]
    while (i < lines.length && lines[i].trim() && !special(lines[i])) body.push(lines[i++])
    const text = body.join('\n')
    blocks.push({ kind: /!\[|<[^>]+>|^\s{2,}[-*+] /mu.test(text) ? 'source' : 'paragraph', text,
      ...(/!\[|<[^>]+>|^\s{2,}[-*+] /mu.test(text) ? { label: translate(locale, "超出支持子集，安全源码展示；不加载 HTML 或媒体") } : {}) })
  }
  return blocks
}
