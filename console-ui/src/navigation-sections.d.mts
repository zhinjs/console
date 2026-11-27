import type { ConsoleAccess } from './utils/console-access.mjs'

export type NavTierId = 'daily' | 'admin'
export type NavSectionId = 'overview' | 'sessions' | 'features' | 'plugins' | 'ops' | 'access'
export interface NavTier { readonly id: NavTierId; readonly label: string }
export interface NavSection { readonly id: NavSectionId; readonly icon: string; readonly label: string; readonly tier: NavTierId; readonly permissions: readonly string[] }
type RouteLike = { path: string; requiredPermissions?: readonly string[]; section?: unknown; meta?: { hideInMenu?: boolean; group?: string; order?: number; [key: string]: unknown } }

export const NAV_TIERS: readonly NavTier[]
export const NAV_SECTIONS: readonly NavSection[]
export const DEFAULT_SECTION_ID: 'features'
export const ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>>
export function resolveSectionId(value: unknown): NavSectionId | null
export function sectionById(id: string): NavSection | null
export function routeSectionId(route: RouteLike): NavSectionId
export function routePermissions(route: RouteLike): readonly string[]
export function canSeeRoute(route: RouteLike, access?: ConsoleAccess): boolean
export function deniedRoutePermissions(route: RouteLike, access?: ConsoleAccess): string[] | null
export type NavMenuGroupId = 'core' | 'plugin'
export interface NavMenuGroup { readonly id: NavMenuGroupId; readonly label: string }
export const NAV_MENU_GROUPS: readonly NavMenuGroup[]
export function isPluginPageRoute(route: RouteLike | null | undefined): boolean
export function buildNavigation<T extends RouteLike>(routes: readonly T[], access?: ConsoleAccess): Array<NavTier & { sections: Array<NavSection & { routes: T[]; groups: Array<NavMenuGroup & { routes: T[] }> }> }>
type BuiltSection<T extends RouteLike> = NavSection & { routes: T[]; groups: Array<NavMenuGroup & { routes: T[] }> }
type BuiltTier<T extends RouteLike> = NavTier & { sections: BuiltSection<T>[] }
export function navSections<T extends RouteLike>(tiers: readonly BuiltTier<T>[]): BuiltSection<T>[]
export function activeSectionId<T extends RouteLike>(tiers: readonly BuiltTier<T>[], activePath: string | undefined, fallback?: RouteLike | null): NavSectionId | null
export function sectionEntryPath(section: { routes?: readonly RouteLike[] } | null | undefined): string | null
export function sectionSubnav<T extends RouteLike>(section: BuiltSection<T> | null | undefined): Array<{ id: NavMenuGroupId; label: string; labelled: boolean; routes: T[] }>
export const TAB_BAR_SECTIONS: 4
export function tabBarModel<T extends RouteLike>(tiers: readonly BuiltTier<T>[], activeId: NavSectionId | null): { tabs: BuiltSection<T>[]; more: boolean; moreActive: boolean }
