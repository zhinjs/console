import type { ConsoleAccess } from './utils/console-access.mjs'

export type NavTierId = 'daily' | 'admin'
export type NavSectionId = 'overview' | 'sessions' | 'features' | 'plugins' | 'ops' | 'access'
export interface NavTier { readonly id: NavTierId; readonly label: string }
export interface NavSection { readonly id: NavSectionId; readonly label: string; readonly tier: NavTierId; readonly permissions: readonly string[] }
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
export function buildNavigation<T extends RouteLike>(routes: readonly T[], access?: ConsoleAccess): Array<NavTier & { sections: Array<NavSection & { routes: T[] }> }>
