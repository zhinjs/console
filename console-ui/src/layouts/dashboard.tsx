import { routeLabel } from '../i18n/navigation'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore } from "react"
import { Outlet, Link, useLocation, matchPath } from "react-router-dom"
import { Menu, LogOut, X, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { app, cn, useWebSocket, type ConsoleRouteRecord } from "@zhin.js/client"
import { getSidebarLucideIcon } from "../components/sidebarMenuIcons"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button, buttonVariants } from "../components/ui/button"
import { ScrollArea } from "../components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip"
import { notifyAuthRequired } from "../utils/auth"
import { isDemoMode } from "../utils/demo-mode"
import { reopenDemoOnboarding } from "../components/DemoOnboarding"
import { ConsoleCommandCenter } from "../components/ConsoleCommandCenter"
import { COLLAPSED_BY_DEFAULT_NAV_GROUPS, NAV_GROUP_ORDER, NAV_GROUPS } from "../navigation-taxonomy"
import { resolveNavigationLocation } from "../navigation-location.mjs"

const MOBILE_MQ = "(max-width: 767px)"
const EXPANDED_GROUPS_KEY = "zhin.console.nav.expanded-groups"
const SIDEBAR_COLLAPSED_KEY = "zhin.console.nav.collapsed"

function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "1"
  } catch {
    return true
  }
}

function writeSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, open ? "0" : "1")
  } catch {
    // Storage may be unavailable (private mode); the preference lasts for this session.
  }
}

function readExpandedGroups(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [])
  } catch {
    return new Set()
  }
}

function writeExpandedGroups(groups: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...groups]))
  } catch {
    // Storage may be unavailable (private mode); folding still works for this session.
  }
}

function useIsMobile() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(MOBILE_MQ)
      mql.addEventListener("change", onStoreChange)
      return () => mql.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia(MOBILE_MQ).matches,
    () => false,
  )
}

function SidebarMenuIcon({ icon }: { icon?: React.ReactNode | string }) {
  if (icon == null) return null
  if (typeof icon === "string") {
    const Cmp = getSidebarLucideIcon(icon)
    return <Cmp className="w-4 h-4" />
  }
  return <>{icon}</>
}

function collectMenuRoutes(routes: readonly ConsoleRouteRecord[]): ConsoleRouteRecord[] {
  return routes.filter((r) => !r.meta?.hideInMenu)
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

export default function DashboardLayout() {
  const i18n = useI18n()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(readSidebarOpen)
  const mainRef = useRef<HTMLElement>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { connected } = useWebSocket()

  const showLabels = isMobile || desktopSidebarOpen
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(readExpandedGroups)
  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      writeExpandedGroups(next)
      return next
    })
  }

  const routes = useSyncExternalStore(
    app.subscribe,
    () => app._getRoutes(),
  )

  const menuRoutes = useMemo(() => {
    return collectMenuRoutes(routes).sort(
      (a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999),
    )
  }, [routes])

  const menuByGroup = useMemo(() => {
    const map = new Map<string, ConsoleRouteRecord[]>()
    for (const r of menuRoutes) {
      const g = r.meta?.group ?? NAV_GROUPS.OTHER
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(r)
    }
    for (const [, items] of map) {
      items.sort((a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999))
    }
    return map
  }, [menuRoutes])

  const contentFullWidth = useRouteMetaFlag(routes, location.pathname, "fullWidth")
  const contentFlush = matchPath(
    { path: '/endpoints/:adapter/:endpointId', end: true },
    location.pathname,
  ) !== null
  const navigation = useMemo(
    () => resolveNavigationLocation(routes, location.pathname, (pattern, pathname) => matchPath({ path: pattern, end: true }, pathname) !== null, i18n.locale),
    [location.pathname, routes, i18n],
  )

  const orderedGroups = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const g of NAV_GROUP_ORDER) {
      if (menuByGroup.has(g) && menuByGroup.get(g)!.length) {
        out.push(g)
        seen.add(g)
      }
    }
    for (const g of menuByGroup.keys()) {
      if (!seen.has(g) && menuByGroup.get(g)!.length) out.push(g)
    }
    return out
  }, [menuByGroup])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  // A new page starts at its top; query-only changes (filters, tabs) keep the scroll position.
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [isMobile, mobileNavOpen])

  const toggleSidebar = () => {
    if (isMobile) setMobileNavOpen((v) => !v)
    else setDesktopSidebarOpen((v) => {
      writeSidebarOpen(!v)
      return !v
    })
  }

  return (
    <div className="console-app-shell flex h-[100dvh] bg-background overflow-hidden">
      <a href="#console-main-content" className="console-skip-link">{i18n.t("跳到主要内容")}</a>
      {isMobile ? (
        <button
          type="button"
          className={cn("console-nav-scrim", mobileNavOpen && "is-open")}
          aria-label={i18n.t("关闭菜单")}
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "console-sidebar",
          isMobile ? cn("is-mobile", mobileNavOpen && "is-open") : !desktopSidebarOpen && "is-collapsed",
        )}
        aria-hidden={isMobile && !mobileNavOpen}
      >
        <div className="console-sidebar-header">
          <Link to="/dashboard" className="console-sidebar-brand" aria-label={isDemoMode() ? "Zhin.js Demo" : "Zhin.js"}>
            <span className="console-brand-mark" aria-hidden="true"><span>Z</span></span>
            {showLabels && (
              <span className="console-sidebar-brand-text">
                <strong>{isDemoMode() ? "Zhin.js Demo" : "Zhin.js"}</strong>
                <small>{isDemoMode() ? i18n.t("零安装 Sandbox") : i18n.t("Bot 工作台")}</small>
              </span>
            )}
          </Link>
          {isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setMobileNavOpen(false)}
              aria-label={i18n.t("关闭菜单")}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <nav className="console-sidebar-nav" aria-label={i18n.t("主导航")}>
            {orderedGroups.map((groupName) => {
              const items = menuByGroup.get(groupName) ?? []
              if (!items.length) return null
              const collapsible = COLLAPSED_BY_DEFAULT_NAV_GROUPS.includes(groupName)
              const open = !collapsible || !showLabels || expandedGroups.has(groupName) || navigation.group === groupName
              return (
                <div key={i18n.t(groupName)} className="console-nav-group">
                  {showLabels ? (collapsible ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(groupName)}
                      className="console-nav-group-label is-toggle"
                    >
                      {i18n.t(groupName)}
                      <ChevronRight className={cn("console-nav-group-chevron", open && "is-open")} aria-hidden="true" />
                    </button>
                  ) : (
                    <div className="console-nav-group-label">{i18n.t(groupName)}</div>
                  )) : <div className="console-nav-group-rule" aria-hidden="true" />}
                  {open && items.map((route, index) => {
                    const itemKey = route.path || `menu-item-${i18n.t(groupName)}-${index}`
                    const isActive = navigation.visible?.path === route.path
                    const label = routeLabel(route, i18n.locale)
                    const link = (
                      <Link
                        key={itemKey}
                        to={route.path}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={showLabels ? undefined : label}
                        onClick={() => {
                          if (isMobile) setMobileNavOpen(false)
                        }}
                        className={cn("console-nav-item", isActive && "is-active")}
                      >
                        <span className="console-nav-icon">
                          <SidebarMenuIcon icon={route.icon} />
                        </span>
                        {showLabels && <span className="truncate">{label}</span>}
                      </Link>
                    )
                    if (showLabels) return link
                    return (
                      <Tooltip key={itemKey} delayDuration={120}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              )
            })}
          </nav>
        </ScrollArea>

        <div className="console-sidebar-footer">
          <span
            className={cn("console-connection-state", connected ? "is-online" : "is-offline")}
            title={connected ? i18n.t("Console 实时事件已连接") : i18n.t("Console 实时事件未连接")}
            aria-label={connected ? i18n.t("Console 实时事件已连接") : i18n.t("Console 实时事件未连接")}
            role="status"
          >
            <span aria-hidden="true" />
            {showLabels ? <span>{connected ? i18n.t("实时事件已连接") : i18n.t("实时事件未连接")}</span> : null}
          </span>
          {!isMobile ? (
            <button
              type="button"
              className="console-sidebar-collapse"
              onClick={toggleSidebar}
              aria-label={desktopSidebarOpen ? i18n.t("收起侧边栏") : i18n.t("展开侧边栏")}
              aria-expanded={desktopSidebarOpen}
              title={desktopSidebarOpen ? i18n.t("收起侧边栏") : i18n.t("展开侧边栏")}
            >
              {desktopSidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </button>
          ) : null}
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0 w-full">
        <header className="console-topbar">
          <div className="console-topbar-location flex items-center gap-2 min-w-0">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label={mobileNavOpen ? i18n.t("关闭菜单") : i18n.t("打开菜单")}
                aria-expanded={mobileNavOpen}
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : null}
            <nav aria-label={i18n.t("当前位置")} className="console-breadcrumb">
              <span className="console-breadcrumb-group">{i18n.t(navigation.group)}</span>
              <ChevronRight aria-hidden="true" className="console-breadcrumb-sep" />
              {navigation.parent && <><Link className="console-breadcrumb-link" to={navigation.parent.path}>{routeLabel(navigation.parent, i18n.locale)}</Link><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></>}
              <span aria-current="page" className="console-breadcrumb-current">{(navigation.current ? routeLabel(navigation.current, i18n.locale) : undefined) ?? (isDemoMode() ? i18n.t("在线 Demo") : i18n.t("首页"))}</span>
            </nav>
          </div>

          <div className="console-topbar-search">
            <ConsoleCommandCenter routes={menuRoutes} />
          </div>

          <div className="console-topbar-actions">
            {isDemoMode() ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="console-topbar-link hidden lg:inline-flex text-xs"
                  onClick={() => reopenDemoOnboarding()}
                >
                  {i18n.t("使用说明")}</Button>
                <a
                  href="https://zhin.js.org/getting-started/first-run"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "console-topbar-link text-xs h-8 px-2.5")}
                >
                  <span className="sm:hidden">{i18n.t("部署")}</span>
                  <span className="hidden sm:inline">{i18n.t("部署到本机")}</span>
                </a>
                <a
                  href="https://zhin.js.org/adapters/icqq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "console-topbar-link text-xs h-8 px-2.5 hidden lg:inline-flex")}
                >
                  {i18n.t("接 QQ Bot")}</a>
                <span className="console-topbar-divider" aria-hidden="true" />
              </>
            ) : null}
            <LanguageSelect />
            <ThemeToggle />
            {!isDemoMode() ? (
            <Button
              variant="ghost"
              size="icon"
              title={i18n.t("退出登录")}
              aria-label={i18n.t("退出登录")}
              onClick={() => {
                notifyAuthRequired()
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
            ) : null}
          </div>
        </header>

        <main
          id="console-main-content"
          ref={mainRef}
          className={cn(
            "console-main-scroll flex-1 min-h-0 min-w-0",
            contentFlush ? "overflow-hidden flex flex-col" : "overflow-y-auto overflow-x-hidden",
          )}
        >
          <div
            key={location.pathname}
            className={cn(
              "console-route-view mx-auto w-full min-w-0",
              contentFlush ? "console-page-flush flex-1 min-h-0 h-full p-0" : "console-main",
              contentFullWidth ? "max-w-none" : "console-content-frame",
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
