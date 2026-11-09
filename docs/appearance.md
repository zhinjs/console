# Console 外观与主题

主题只改变当前浏览器的呈现，不修改 Host、Bot 配置或消息内容。

## 验收截图

- [松青 · 手机外观面板](assets/appearance-pine-mobile.jpg)
- [暮紫 · 桌面暗色工作区](assets/appearance-plum-desktop.jpg)

截图使用本地模拟数据，不连接真实平台或模型。全部 776 项测试、类型检查、生产构建通过；浏览器验证了配色即时切换、刷新保留、持续跟随系统、默认恢复与手机布局。

## 两个独立选择

点击顶栏主题按钮打开外观面板：

- 显示模式：亮色、暗色、跟随系统。跟随系统会持续响应系统变化，不将当前系统模式保存成手动选择。
- 配色：松青（默认）、海蓝、暮紫、石墨。配色覆盖工作区底色、导航、选中态、聊天气泡、主要按钮与键盘焦点；石墨保持中性表面。

每套配色都单独定义亮暗层次。成功、警告、危险及图表类别颜色不随装饰配色变更，避免语义漂移。所有组合的文字、输入边界与焦点对比度由测试校验。

## 偏好与兼容

- 仅保存两个经过枚举校验的标量：`theme`（`light` / `dark` / `system`）、`zhin.console.palette`（四种配色 ID）。
- 已有 `theme=light/dark` 选择保留。没有选择时默认为跟随系统与松青。
- 无效值回到默认设置；浏览器阻止存储时，本次页面仍可即时切换。
- 同一浏览器的其他 Console 标签页会同步偏好；清除偏好恢复默认。
- “恢复默认外观”同时恢复跟随系统与松青，不修改其他浏览器数据。

## 初始化与样式边界

`client/index.html` 的早期脚本在应用和样式绘制前设置模式和配色属性，避免先闪现错误主题。运行时继续监听系统与跨标签页变化，更新浏览器主题色。两套 Console 入口共用 CSS 变量；旧版本曾写入的 inline 主题变量仅按已知名单清除，不删除扩展自己的样式。

关键文件：

- `console-ui/src/theme/index.ts`：偏好校验、模式解析、监听与通知。
- `console-ui/src/theme-tokens.css`：完整亮暗配色和稳定语义色。
- `console-ui/src/hooks/useTheme.ts`：统一订阅，多个控件不产生独立主题状态。
- `console-ui/src/components/ThemeToggle.tsx`：可键盘操作的原生单选组和外观面板。
- `tests/theme-runtime.test.mjs`：迁移、系统变化、存储失败、跨标签同步、早期脚本。
- `tests/visual-foundation.test.mjs`：全部八种亮暗配色的对比度与语义色稳定性。
- `tests/theme-controls.test.mjs`：独立选择、文案与默认恢复。
