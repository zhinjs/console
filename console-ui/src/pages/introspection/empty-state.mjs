import { translate } from '../../i18n/locale.mjs'
export function capabilityEmptyState({ title, filter = '', total = 0 }, locale = 'zh-CN') {
 const normalized = filter.trim()
 if (normalized) return {
   title: translate(locale, "没有匹配“{0}”的{1}", [normalized, title]),
   description: translate(locale, "当前筛选没有匹配项；清除筛选后查看已注册的能力。"),
   clearFilter: true,
 }
 if (total > 0) return {
   title: translate(locale, "当前页没有能力条目"),
   description: translate(locale, "能力目录仍有记录，请返回上一页或刷新列表。"),
   clearFilter: false,
 }
 return {
   title: translate(locale, "当前 generation 没有{0}", [title]),
   description: translate(locale, "这里展示 Runtime 已实际注册的能力；配置存在但尚未发布的内容不会出现。"),
   clearFilter: false,
 }
}
