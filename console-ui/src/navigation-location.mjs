import { translate } from './i18n/locale.mjs'
/** Resolve registered page identity separately from its visible navigation owner. */
export function resolveNavigationLocation(routes, pathname, matches, locale = 'zh-CN') {
  const sorted = [...routes].sort((a,b) => b.path.length - a.path.length);
  const current = sorted.find(route => matches(route.path, pathname)) ?? null;
  // Details may have another hidden detail as their parent. Walk registered
  // ancestors to keep their visible menu owner without relying on URL prefixes.
  const visited = new Set(current ? [current.path] : []);
  let parent = null;
  let parentPath = current?.parent;
  while (parentPath && !visited.has(parentPath)) {
    visited.add(parentPath);
    const ancestor = routes.find(route => route.path === parentPath);
    if (!ancestor) break;
    if (!ancestor.meta?.hideInMenu) {
      parent = ancestor;
      break;
    }
    parentPath = ancestor.parent;
  }
  const visible = current && !current.meta?.hideInMenu ? current : parent ?? sorted.find(route => !route.meta?.hideInMenu && (pathname === route.path || pathname.startsWith(`${route.path}/`))) ?? null;
  return { current, parent, visible, group: current?.meta?.group ?? parent?.meta?.group ?? visible?.meta?.group ?? translate(locale, "其他") };
}
