/** Resolve registered page identity separately from its visible navigation owner. */
export function resolveNavigationLocation(routes, pathname, matches) {
  const sorted = [...routes].sort((a,b) => b.path.length - a.path.length);
  const current = sorted.find(route => matches(route.path, pathname)) ?? null;
  const parent = current?.parent ? routes.find(route => route.path === current.parent && !route.meta?.hideInMenu) ?? null : null;
  const visible = current && !current.meta?.hideInMenu ? current : parent ?? sorted.find(route => !route.meta?.hideInMenu && (pathname === route.path || pathname.startsWith(`${route.path}/`))) ?? null;
  return { current, parent, visible, group: current?.meta?.group ?? parent?.meta?.group ?? visible?.meta?.group ?? '其他' };
}
