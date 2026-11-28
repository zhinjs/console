# Console 外观与主题

主题只改变当前浏览器的呈现，不修改 Host、Bot 配置或消息内容。

## 柔光卡片

颜色、字号、圆角、阴影与动效全部来自 `@zhin.js/console-ui` 1.3.0 的「柔光卡片」规范（zhinjs/zhin ADR 0063 D34–D41）：黑白主色、暖灰底色、五组浅色类别色、大圆角无描边卡片、胶囊按钮。Console 不再有自己的调色板，也不再提供配色选择；`data-palette` 不再写入。

类别色按「类别对应表」固定（同一个东西在所有页面颜色一样）：

| 组 | 浅彩 / 图标色 | 用在 |
| --- | --- | --- |
| 1 | 杏 / 珊瑚 | 聊天账号、适配器 |
| 2 | 粉 / 玫红 | 插件 |
| 3 | 黄绿 / 橄榄 | 模型、Agent |
| 4 | 薄荷 / 青绿 | 会话、消息 |
| 5 | 奶黄 / 芥黄 | 定时任务、时间 |
| 中性 | sunken / ink | 实例、运维、访问控制 |

图表：消息量「收到」用 `chart-1`（杏），「回复」用 `chart-2`（孔雀青）；状态（正常 / 失败）只用 `ok` / `danger`，不用图表色。

## 显示模式

用户菜单（顶栏右侧的圆形账号按钮）里的「显示模式」有三项：

- 浅色：`<html class="light">`，不写 `data-theme`（组件库什么都不写时就是浅色）。
- 深色：`<html class="dark">`。
- 跟随系统（默认）：`<html data-theme="system">`，由组件库的 `prefers-color-scheme` 规则选择浅色或深色；同时写入解析后的 `.light` / `.dark` 类，供 Console 自己的 `.dark` 规则和 Tailwind 的 `dark:` 使用，并随系统变化更新。

浏览器主题色（`<meta name="theme-color">`）固定为浅色 `#F7F5F3`、深色 `#121010`。

## 偏好与兼容

- 只保存一个经过枚举校验的标量：`theme`（`light` / `dark` / `system`）。已有选择保留；没有选择时跟随系统。
- 旧版本保存的配色 `zhin.console.palette` 不再读取，首次加载时删除。
- 无效值回到默认设置；浏览器阻止存储时，本次页面仍可即时切换。
- 同一浏览器的其他 Console 标签页会同步偏好。

## 初始化与样式边界

`client/index.html` 的早期脚本在应用和样式绘制前设置模式，避免先闪现错误主题。运行时继续监听系统与跨标签页变化。旧版本曾写入的 inline 主题变量仅按已知名单清除，不删除扩展自己的样式。

关键文件：

- `console-ui/src/theme/index.ts`：偏好校验、模式解析、监听与通知。
- `console-ui/src/theme-tokens.css`：组件库没有的几个旧名字，全部指向组件库的令牌。
- `console-ui/src/hooks/useTheme.ts`：统一订阅，多个控件不产生独立主题状态。
- `console-ui/src/components/UserMenu.tsx`：显示模式的单选菜单项。
- `tests/theme-runtime.test.mjs`：迁移、系统变化、存储失败、跨标签同步、早期脚本。
- `tests/visual-foundation.test.mjs`：浅色 / 深色的对比度与颜色角色。
- `tests/theme-controls.test.mjs`：三种显示模式。
