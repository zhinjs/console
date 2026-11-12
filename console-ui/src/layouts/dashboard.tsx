import { routeLabel } from '../i18n/navigation'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore } from "react"
import { Outlet, Link, useLocation, matchPath } from "react-router-dom"
import { Menu, LogOut, X, ChevronRight, ChevronDown, UserRound } from "lucide-react"
import { cn, type ConsoleRouteRecord } from "@zhin.js/client"
import { useConsoleConnected } from "../hooks/use-console-connected"
import { app } from "../utils/console-client"
import { getSidebarLucideIcon } from "../components/sidebarMenuIcons"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button } from "../components/ui/button"
import { ScrollArea } from "../components/ui/scroll-area"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu"
import { signOut } from "../utils/console-auth-api"
import { principalLabel } from "../utils/console-auth-model.mjs"
import { useConsoleSession } from "../hooks/use-console-session"
import { OnboardingBanner } from "../components/onboarding-banner"
import { InstanceUnavailableBanner } from "../components/InstanceUnavailableBanner"
import { CONSOLE_PATHS } from "../console-routes.mjs"
import { objectPageOwnsBreadcrumb } from "../scope/scope-tree.mjs"
import { ConsoleCommandCenter } from "../components/ConsoleCommandCenter"
import "./workspace-navigation.css"
import { resolveNavigationLocation } from "../navigation-location.mjs"
import { buildNavigation, routeSectionId, sectionById } from "../navigation-sections.mjs"
import { useConsoleAccess } from "../hooks/use-console-access"

import { useIsCompactNav } from '../hooks/useIsMobile'
import { ListItemButton } from '../components/ui/list-item-button'
const HOME_PATH = "/dashboard"

function NavIcon({ icon }: { icon?: React.ReactNode | string }) {
  if (icon == null) return null
  if (typeof icon === "string") {
    const Cmp = getSidebarLucideIcon(icon)
    return <Cmp className="w-4 h-4" />
  }
  return <>{icon}</>
}

function useRouteMetaFlag(
  routes: readonly ConsoleRouteRecord[],
  pathname: string,
  flag: "fullWidth",
): boolean {
  return useMemo(() => {
    for (const r of routes) {
      if (!r.meta?.[flag] || !r.path) continue
      if (matchPath({ path: r.path, end: true }, pathname)) return true
    }
    return false
  }, [routes, pathname, flag])
}

/**
 * Console shell: a floating capsule navigation bar over a gray canvas, content centered below it.
 * Wide screens show the six sections in the bar (a section with one page is a link, a section with
 * several pages opens a menu); narrower screens move the same navigation into a drawer.
 */
export default function DashboardLayout() {
  const i18n = useI18n()
  const location = useLocation()
  const compact = useIsCompactNav()
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const connected = useConsoleConnected()

  const routes = useSyncExternalStore(
    app.subscribe,
    () => app.getRoutes(),
  )
  const access = useConsoleAccess()
  const { me } = useConsoleSession()
  const accountLabel = principalLabel(me, i18n.t)
  // Sections the principal has no page in are omitted entirely (ADR 0052).
  const navTiers = useMemo(() => buildNavigation(routes, access), [routes, access])

  const contentFullWidth = useRouteMetaFlag(routes, location.pathname, "fullWidth")
  const navigation = useMemo(
    () => resolveNavigationLocation(routes, location.pathname, (pattern, pathname) => matchPath({ path: pattern, end: true }, pathname) !== null, i18n.locale),
    [location.pathname, routes, i18n],
  )

  const currentLabel = navigation.current ? routeLabel(navigation.current, i18n.locale) : i18n.t("首页")
  const onHome = navigation.current?.path === HOME_PATH
  const navOwner = navigation.current ?? navigation.parent ?? navigation.visible
  const groupLabel = i18n.t(navOwner ? sectionById(routeSectionId(navOwner))?.label ?? navigation.group : navigation.group)
  const parentLabel = navigation.parent ? routeLabel(navigation.parent, i18n.locale) : null
  const activePath = navigation.visible?.path
  const drawerVisible = compact && drawerOpen

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // A new page starts at its top; query-only changes (filters, tabs) keep the scroll position.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  // The bar turns more opaque once content scrolls beneath it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    if (!drawerVisible) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // A Radix layer (menu, popover) consumes its own Escape first; the next one closes the drawer.
      if (e.key === "Escape" && !e.defaultPrevented) setDrawerOpen(false)
    }
    drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKeyDown)
      menuButtonRef.current?.focus()
    }
  }, [drawerVisible])

  const connectionTitle = connected ? i18n.t("Console 实时事件已连接") : i18n.t("Console 实时事件未连接")

  /** Wide-screen bar: one item per section, separated into the 日常 and 管理 tiers. */
  const barNavigation = (
    <nav className="console-topnav-nav" aria-label={i18n.t("主导航")}>
      {navTiers.map((tier, tierIndex) => <div key={tier.id} className="console-nav-tier" data-tier={tier.id} role="group" aria-label={i18n.t(tier.label)}>
        {tierIndex > 0 ? <span className="console-nav-tier-rule" aria-hidden="true" /> : null}
        {tier.sections.map((section) => {
          const sectionActive = section.routes.some((route) => route.path === activePath)
          if (section.routes.length === 1) {
            const route = section.routes[0]
            const isActive = route.path === activePath
            return (
              <div key={section.id} className="console-nav-group" data-section={section.id}>
                <Link
                  to={route.path}
                  aria-current={isActive ? "page" : undefined}
                  className={cn("console-topnav-item", isActive && "is-active")}
                >
                  <span className="console-nav-icon"><NavIcon icon={route.icon ?? section.icon} /></span>
                  <span className="truncate">{routeLabel(route, i18n.locale)}</span>
                </Link>
              </div>
            )
          }
          return (
            <div key={section.id} className="console-nav-group" data-section={section.id}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={cn("console-topnav-item", sectionActive && "is-active")} data-active={sectionActive ? "true" : undefined}>
                    <span className="console-nav-icon"><NavIcon icon={section.icon} /></span>
                    <span className="truncate">{i18n.t(section.label)}</span>
                    <ChevronDown aria-hidden="true" className="console-topnav-chevron" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={10} className="console-topnav-menu">
                  {section.routes.map((route, index) => {
                    const isActive = route.path === activePath
                    return (
                      <DropdownMenuItem key={route.path || `menu-item-${section.id}-${index}`} asChild>
                        <Link to={route.path} aria-current={isActive ? "page" : undefined} className={cn("console-topnav-menu-item", isActive && "is-active")}>
                          <span className="console-topnav-menu-icon"><NavIcon icon={route.icon} /></span>
                          <span className="min-w-0 truncate">{routeLabel(route, i18n.locale)}</span>
                        </Link>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}
      </div>)}
    </nav>
  )

  /** Drawer navigation (narrow screens): every page listed under its tier and section. */
  const drawerNavigation = (
    <nav className="console-drawer-nav" aria-label={i18n.t("主导航")}>
      {navTiers.map((tier) => <div key={tier.id} className="console-nav-tier" data-tier={tier.id}>
        <div className="console-nav-tier-label">{i18n.t(tier.label)}</div>
        {tier.sections.map((section) => {
          // A section whose only page carries the section's own name (e.g. Sandbox "会话") needs no heading.
          const showGroupLabel = !(section.routes.length === 1 && routeLabel(section.routes[0], i18n.locale) === i18n.t(section.label))
          return (
            <div key={section.id} className="console-nav-group" data-section={section.id}>
              {showGroupLabel ? <div className="console-nav-group-label">{i18n.t(section.label)}</div> : null}
              {section.routes.map((route, index) => {
                const isActive = route.path === activePath
                return (
                  <Link
                    key={route.path || `menu-item-${section.id}-${index}`}
                    to={route.path}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setDrawerOpen(false)}
                    className={cn("console-nav-item", isActive && "is-active")}
                  >
                    <span className="console-nav-icon"><NavIcon icon={route.icon} /></span>
                    <span className="truncate">{routeLabel(route, i18n.locale)}</span>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </div>)}
    </nav>
  )

  return (
    <div className="console-app-shell" data-wide={contentFullWidth ? "true" : undefined}>
      <a href="#console-main-content" className="console-skip-link">{i18n.t("跳到主要内容")}</a>

      <header className={cn("console-topnav", scrolled && "is-scrolled")} inert={drawerVisible}>
        <div className="console-topnav-capsule">
          {compact ? (
            <Button
              variant="ghost"
              size="icon"
              className="console-topnav-menu-button"
              ref={menuButtonRef}
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label={drawerOpen ? i18n.t("关闭菜单") : i18n.t("打开菜单")}
              aria-expanded={drawerOpen}
            >
              <Menu className="h-5 w-5" />
            </Button>
          ) : null}
          <Link to="/" className="console-brand" aria-label="Zhin.js">
            <span className="console-brand-mark" aria-hidden="true"><span>Z</span></span>
            <span className="console-brand-text">Zhin.js</span>
          </Link>

          {compact ? null : barNavigation}

          <div className="console-topnav-actions">
            <ConsoleCommandCenter routes={routes} />
            <span
              className={cn("console-connection-dot", connected ? "is-online" : "is-offline")}
              title={connectionTitle}
              aria-label={connectionTitle}
              role="status"
            />
            <LanguageSelect />
            <ThemeToggle />
            {me?.user ? (
              <Button asChild variant="ghost" size="sm" className="console-topnav-account">
                <Link to={CONSOLE_PATHS.account} title={i18n.t("个人设置")} aria-label={i18n.t("个人设置：{0}", [accountLabel])}>
                  <UserRound className="h-4 w-4" />
                  <span className="hidden xl:inline max-w-[8rem] truncate">{accountLabel}</span>
                </Link>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              title={i18n.t("退出登录")}
              aria-label={i18n.t("退出登录")}
              onClick={() => {
                void signOut(me)
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {compact ? (
        <ListItemButton
          type="button"
          className={cn("console-nav-scrim", drawerOpen && "is-open")}
          aria-label={i18n.t("关闭菜单")}
          aria-hidden={!drawerOpen}
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      {compact ? (
        <aside
          className={cn("console-nav-drawer", drawerOpen && "is-open")}
          ref={drawerRef}
          aria-hidden={!drawerOpen}
          inert={!drawerOpen}
          aria-label={i18n.t("主导航")}
        >
          <div className="console-nav-drawer-header">
            <Link to="/" className="console-brand" aria-label="Zhin.js" onClick={() => setDrawerOpen(false)}>
              <span className="console-brand-mark" aria-hidden="true"><span>Z</span></span>
              <span className="console-brand-text">Zhin.js</span>
            </Link>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDrawerOpen(false)} aria-label={i18n.t("关闭菜单")}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0">{drawerNavigation}</ScrollArea>
          <div className="console-nav-drawer-footer">
            <span className={cn("console-connection-state", connected ? "is-online" : "is-offline")} title={connectionTitle} role="status">
              <span aria-hidden="true" />
              <span>{connected ? i18n.t("实时事件已连接") : i18n.t("实时事件未连接")}</span>
            </span>
          </div>
        </aside>
      ) : null}

      <main
        id="console-main-content"
        className="console-main-scroll"
        inert={drawerVisible}
      >
        <div
          className={cn(
            "console-main mx-auto w-full min-w-0",
            contentFullWidth ? "max-w-none" : "console-content-frame",
          )}
        >
          <InstanceUnavailableBanner />
          <OnboardingBanner />
          {/* Object pages below 全局 render their own scope breadcrumb; one breadcrumb per page. */}
          {onHome || objectPageOwnsBreadcrumb(location.pathname) ? null : <nav aria-label={i18n.t("当前位置")} className="console-breadcrumb">
            {groupLabel !== currentLabel && groupLabel !== parentLabel ? <><span className="console-breadcrumb-group">{groupLabel}</span><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
            {navigation.parent && parentLabel !== currentLabel ? <><Link className="console-breadcrumb-link" to={navigation.parent.path}>{parentLabel}</Link><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
            <span aria-current="page" className="console-breadcrumb-current">{currentLabel}</span>
          </nav>}
          <div key={location.pathname} className="console-route-view">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
