# Console 基础视觉验收清单

本片范围：共享主题、外壳、页面标题、共享 Card / Button / Input / Textarea / Select。
不修改业务请求、权限、表单数据、路由或确认流程。

## 设计规则

- 两个入口均通过 design-system.css 引入唯一 theme-tokens.css；不再分别维护薄荷绿主题。
- applyTheme 仅切换模式 class，并移除旧版写入的已知 inline palette；运行时不得再覆写 CSS 色值。
- 登录入口品牌图形同样使用灰阶 primary/foreground，不再保留独立绿色渐变。
- 常规背景、文字、主按钮、选中项、输入边框和焦点环为零饱和灰阶。
- 亮色：97% 页面背景、100% 卡片、12% 正文；暗色：8% 背景、12% 卡片、94% 正文。
- 状态、错误和危险操作允许小面积语义色；状态同时以文字/图标表达。
- 页标题 24–30px，节标题 16px，正文 14px，辅助标签 13px；标题/说明控制行长。
- 系统字体含中文 fallback，不新增远程字体请求；数据控件使用等宽数字。
- 内部控件 10px、卡片 14px、上层容器 18px 圆角；边框与阴影承担层级，不加背景装饰。
- 外壳、品牌、命令入口使用灰阶实色或透明 surface；去除这些区域的装饰渐变。
- 共享控件使用可见焦点环；禁用状态保留灰阶与明确原生 disabled 行为。
- 保留现有 reduced-motion 规则；无新增动效依赖或全局元素强制覆写。

## 自动验收

- 正文与辅助文字对相应背景达到 WCAG AA 4.5:1。
- 主按钮文字对主按钮底色达到 4.5:1。
- 输入边界与焦点环相对背景达到 3:1。
- 两套主题共用来源，不存在入口私有重复 palette。
- 类型检查和现有业务回归通过；生产构建成功。

## 浏览器待验（由 root 执行）

- [x] /logs 亮色截图：无薄荷绿背景/选中，筛选及分页可见，渐进披露可发现。
- [x] /logs 暗色截图：背景/卡片/浮层层级清楚，主按钮/焦点环无残留亮色主题。
- [ ] /endpoints 或 /files 两主题：标题、说明、Card 和输入尺寸一致。
- [ ] Tab 导航：输入、主题按钮、导航和共享按钮焦点清晰。
- [ ] 禁用维护按钮不被淡化为可点击，已有权限锁不变。
- [ ] 窄屏标题与动作自然换行，无横向溢出。

## 后续逐片处理

业务页私有色彩、硬编码微小字号、私有装饰和内容密度仍需逐页复核，不能以本片基础 token 完成替代实际明暗截图验收。

## 私有视觉第二片（待浏览器复验）

- Agent playground accent 继承 primary / primary-foreground；移除固定绿色和背景装饰。
- Agent playground 所有 CSS 小字号至少 12px；细标签不强制全大写。
- 会话头像所有 identity 采用灰阶 paired tokens，显示名/initial/channel icon 保留。
- IM 出站气泡、渠道图标、成员头像去除固定彩色渐变并匹配前景色。
- 暗色危险状态增亮；自动对比度检查覆盖图标色对背景及危险按钮文字。
- Agent workbench 641–1199px 指标使用两列，标签不逐字折行。
- 测试：私有视觉/initial 2 项，主题真实 applyTheme 1 项，主题对比度 2 项；完整 Console suite 88 项通过。

## 用户视觉纠正后的当前规范

以下规则覆盖前文“常规主按钮零饱和”的旧版本：

- 页面底色：亮色白（100%），暗色近黑（4%）；卡片直接使用 foreground 的局部透明灰层，不是白卡片叠白背景。
- raised 灰块亮色 alpha .035 / 暗色 .065；muted 灰块 .055 / .09；inset .025 / .04。
- 文字不使用父容器 opacity；灰层透明度仅作用于背景。
- 导航、身份头像维持灰阶；主动作使用克制蓝，success/info/warning/danger 为小面积状态语义色。
- --status-warning 采用完整名字，与日志工作台契约一致。
- 状态必须有文字或图标，颜色不单独承担含义；两主题状态前景对背景至少3:1，填充状态按钮文字至少4.5:1。

| 设备宽度 | 辅助字号 | 正文字号 | 页标题 | 标准输入/主按钮 |
| --- | --- | --- | --- | --- |
| 手机 <768px | 12px | 13px | 22px | 44px |
| 平板 768–1199px | 13px | 14px | 24px | 36px |
| 桌面 ≥1200px | 13px | 14px | 28px | 36px |

日志维护/分页等密集操作使用其独立 responsive 规范：桌面32px、平板36px、手机44px；页码桌面13px/手机12px。业务页可基于信息密度选择更紧凑辅助操作，但手机主操作维持可点击目标44px。

Agent 工作台顶部去除宣传标题、圆弧和装饰渐变，优先显示实际读取状态、缺项与真实下一步入口；模型验证边界放入默认闭合“状态说明”。读取失败不把缓存摘要当本次读取成功。

## 响应式共享规范的实际消费（第三片）

- 共享文字 role：title / title-compact / section / section-sm / body / body-sm / label / code，行高分别由 leading-role 控制；body 设置到两个入口的 body 元素。
- 手机标准与紧凑动作44px、平板36px、桌面标准36px/紧凑32px。
- radius sm/md/lg/xl：手机6/8/12/16px，平板及桌面8/10/14/18px。
- border width 1px、focus width2px；边框色保持中性，根据明暗主题改变强度。
- shadow使用相同中性阴影色，明暗改变 alpha；sm/md/lg blur 手机6/12/20px、平板8/16/28px、桌面10/20/36px。
- Card、Button、Input、Textarea、Select、Tabs、Dialog、DropdownMenu、Badge、Alert、EmptyState 与通用设计系统类实际引用 role/radius/shadow/border tokens。
- Pills/circles 的形状语义保留；矩形共享容器取消随意四角不对称值。Metric/display 数据字号保留层级，不盲目改成正文字号。
- Logs 局部紧凑标题/正文/metadata 对应 title-compact/body-sm/label；Files code 使用 code 字号，overlay 行高保持 pre/textarea 一致。
- 构建检查 `node scripts/check-visual-build.mjs` 从 dist/index.html 的真实 stylesheet links 读取已编译 CSS，检查390/768/1920px × light/dark 的角色、控件、radius、surface、shadow生成与变量解析。构建检查不能替代浏览器computed style与实际点击验收。

## 真实浏览器已确认（root 验收记录）

- 共享明暗主题 computed palette 与截图通过；主题切换等待 settled 后检查。
- 768px Agent 指标2×2，无横向溢出；Workroom/KV非空渐进披露通过。
- Files TS/JSON/YAML 三语言本地高亮、两主题、pre/textarea 行高20px对齐与安全转义通过。
- JSON tree 展开/收起及高亮通过；组件按钮走正式 Host 真实预览成功。
- 390px 实际 role：title22px、code12px、radius12px、control44px通过。
- 最终统一构建包含预览按钮、组件详情、示例参数与技术信息默认折叠的文案收尾；98项完整回归、typecheck、构建与已链接CSS六组合检查通过。

本记录仅覆盖上述真实路径，不扩大为未经点击的全站功能/视觉通过。
