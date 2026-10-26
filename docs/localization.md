# Console 界面语言

登录页和工作台顶部的语言选择器支持简体中文（`zh-CN`）和英文（`en`）。未选择时使用中文；不会根据浏览器语言自动切换。选择保存在当前站点的 `localStorage` 键 `zhin.console.locale`，存储不可用时仍可在本次页面中切换。

界面语言独立于 Bot 的项目语言、发送者个人偏好和时区。切换不会修改 Host 配置、认证凭据、任务参数或现有配置/文件草稿。日期和数字使用选择的语言格式；已有明确时区继续使用该时区，没有指定时区的页面继续沿用浏览器时区。

## 覆盖与边界

内置登录、导航、快速入口、概览、渠道与会话、消息诊断、配置表单与字段解释、插件管理与市场、任务中心、提醒、场景试验台、权限解释、Agent、Workroom、文件、环境变量、数据库和日志页面的静态文案使用同一目录。

用户输入、消息正文、文件内容、环境变量引用、字段名、协议值、ID 和第三方动态文本保持原样。没有提供语言元数据的第三方 Schema 标题、工具描述、插件介绍和 Host 错误会保留原文。Console 不会把它们当作自己的翻译键，也不会宣称这些原文已经本地化。

任务提供方与用途目录通过 `?locale=zh-CN|en` 请求展示语言；任务变更请求携带相同的 `locale`，仅影响回执展示，不进入参数或 CAS 操作身份。需要支持这一显示契约的 Host。其他动态服务端信息继续由服务端负责提供，不在前端猜测翻译。

## Schema 显示扩展

每个 Schema 节点可声明 `x-i18n.en`。`title`、`description` 仅覆盖展示；`enumLabels` 按 `String(option.value)` 匹配，选项重排不会把标签对应到错误值。

```ts
{
  type: 'string',
  title: '模式',
  options: [
    { value: 'off', label: '关闭' },
    { value: 'on', label: '开启' },
  ],
  'x-i18n': {
    en: {
      title: 'Mode',
      description: 'Choose a mode',
      enumLabels: { off: 'Off', on: 'On' },
    },
  },
}
```

选项本身也可携带 `x-i18n.en.title`（例如 Host 从 `anyOf` 常量分支投影的标签）。节点的 `enumLabels` 优先；缺少翻译时保留原标签。嵌套节点分别处理，原始字段、默认值、校验规则、选中值和保存值不变。

## 新增界面文案

React 组件使用 `useI18n()`；类组件可使用 `LocalizedText`。纯模型函数接收明确的 `locale` 参数（默认中文），调用 `translate()`。英文目录在 `console-ui/src/i18n/messages.en.mjs`，原始文案作为稳定键，插值使用 `{0}`、`{1}` 等编号。同一中文有不同语义时可使用 context，例如 `t('关闭', undefined, 'state')` 表示 Off，而默认动作为 Close；目录以 `state\u0004关闭` 保存该上下文。不要翻译插值中的用户内容或对 DOM 文本做批量替换。

显示使用的 `useMemo` / `useCallback` 必须跟随语言更新。用于读取并初始化编辑草稿的回调则通过 ref 获取最新文案，不能仅因为界面语言变化重新加载草稿。权限、业务状态和错误分类不应依赖翻译后的显示文案。

`pnpm test` 检查目录插值、显式文案覆盖、独立 React Context、Schema 的稳定值映射、实际表单选项事件、配置草稿与原始修订保留，以及原有保存/权限/回执回归。`pnpm typecheck` 和 `pnpm build` 检查类型与生产构建。浏览器验收应加载当前 `dist`，用合成 Host 验证切换和回显；这不代表真实 Host、第三方插件或平台投递验收。

## Interface language (English)

Use the language selector on the sign-in screen or dashboard to choose Simplified Chinese or English. Chinese is the default; browser language is never used to choose automatically. Your preference is saved locally for this Console site and is separate from the Bot language and timezone.

Switching language preserves configuration values and unsaved drafts. User content, machine identifiers, and third-party text without language metadata remain unchanged. Schema authors can provide `x-i18n.en` display metadata as shown above; enum labels are keyed by the string representation of their original values.
