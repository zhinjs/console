type Route = { path: string; parent?: string | null; name: string; meta?: { hideInMenu?: boolean; group?: string; [key:string]:unknown } };
export function resolveNavigationLocation<T extends Route>(routes: readonly T[], pathname: string, matches: (pattern: string, pathname: string) => boolean, locale?: 'zh-CN' | 'en'): { current: T | null; parent: T | null; visible: T | null; group: string };
