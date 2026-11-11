import { routeLabel } from '../i18n/navigation'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore } from "react"
import { Outlet, Link, useLocation, matchPath } from "react-router-dom"
import { Menu, LogOut, X, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn, type ConsoleRouteRecord } from "@zhin.js/client"
import { useConsoleConnected } from "../hooks/use-console-connected"
import { app } from "../utils/console-client"
import { getSidebarLucideIcon } from "../components/sidebarMenuIcons"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button } from "../components/ui/button"
import { ScrollArea } from "../components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip"
import { notifyAuthRequired } from "../utils/auth"
import { ConsoleCommandCenter } from "../components/ConsoleCommandCenter"
import "./workspace-navigation.css"
import { resolveNavigationLocation } from "../navigation-location.mjs"
import { buildNavigation, routeSectionId, sectionById } from "../navigation-sections.mjs"
import { useConsoleAccess } from "../hooks/use-console-access"

import { useIsMobile } from '../hooks/useIsMobile'
import { ListItemButton } from '../components/ui/list-item-button'
const SIDEBAR_COLLAPSED_KEY = "zhin.console.nav.collapsed"
const HOME_PATH = "/dashboard"

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

function SidebarMenuIcon({ icon }: { icon?: React.ReactNode | string }) {
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

export default function DashboardLayout() {
  const i18n = useI18n()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(readSidebarOpen)
  const mainRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const connected = useConsoleConnected()

  const showLabels = isMobile || desktopSidebarOpen

  const routes = useSyncExternalStore(
    app.subscribe,
    () => app.getRoutes(),
  )
  const access = useConsoleAccess()
  // Sections the principal has no page in are omitted entirely (ADR 0052).
  const navTiers = useMemo(() => buildNavigation(routes, access), [routes, access])

  const contentFullWidth = useRouteMetaFlag(routes, location.pathname, "fullWidth")
  const contentFlush = matchPath(
    { path: '/endpoints/:adapter/:endpointId', end: true },
    location.pathname,
  ) !== null
  const navigation = useMemo(
    () => resolveNavigationLocation(routes, location.pathname, (pattern, pathname) => matchPath({ path: pattern, end: true }, pathname) !== null, i18n.locale),
    [location.pathname, routes, i18n],
  )

  const currentLabel = navigation.current ? routeLabel(navigation.current, i18n.locale) : i18n.t("首页")
  const onHome = navigation.current?.path === HOME_PATH
  const navOwner = navigation.current ?? navigation.parent ?? navigation.visible
  const groupLabel = i18n.t(navOwner ? sectionById(routeSectionId(navOwner))?.label ?? navigation.group : navigation.group)
  const parentLabel = navigation.parent ? routeLabel(navigation.parent, i18n.locale) : null

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
      if (e.key === "Escape" && !e.defaultPrevented) setMobileNavOpen(false)
    }
    sidebarRef.current?.querySelector<HTMLElement>("button, a")?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKeyDown)
      mobileMenuButtonRef.current?.focus()
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
        <ListItemButton
          type="button"
          className={cn("console-nav-scrim", mobileNavOpen && "is-open")}
          aria-label={i18n.t("关闭菜单")}
          aria-hidden={!mobileNavOpen}
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "console-sidebar",
          isMobile ? cn("is-mobile", mobileNavOpen && "is-open") : !desktopSidebarOpen && "is-collapsed",
        )}
        ref={sidebarRef}
        aria-hidden={isMobile && !mobileNavOpen}
        inert={isMobile && !mobileNavOpen}
      >
        <div className="console-sidebar-header">
          <Link to="/" className="console-sidebar-brand" aria-label="Zhin.js">
            <span className="console-brand-mark" aria-hidden="true"><span>Z</span></span>
            {showLabels && (
              <span className="console-sidebar-brand-text">
                <strong>Zhin.js</strong>
                <small>{i18n.t("Bot 工作台")}</small>
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
            {navTiers.map((tier) => <div key={tier.id} className="console-nav-tier" data-tier={tier.id}>
              {showLabels ? <div className="console-nav-tier-label">{i18n.t(tier.label)}</div> : null}
              {tier.sections.map((section) => {
              const items = section.routes
              const groupName = section.label
              // A section whose only page carries the section's own name (e.g. Sandbox "会话") needs no heading.
              const showGroupLabel = !(items.length === 1 && routeLabel(items[0], i18n.locale) === i18n.t(groupName))
              return (
                <div key={section.id} className="console-nav-group" data-section={section.id}>
                  {showLabels ? showGroupLabel && <div className="console-nav-group-label">{i18n.t(groupName)}</div>
                    : <div className="console-nav-group-rule" aria-hidden="true" />}
                  {items.map((route, index) => {
                    const itemKey = route.path || `menu-item-${section.id}-${index}`
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
            </div>)}
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
            <ListItemButton
              type="button"
              className="console-sidebar-collapse"
              onClick={toggleSidebar}
              aria-label={desktopSidebarOpen ? i18n.t("收起侧边栏") : i18n.t("展开侧边栏")}
              aria-expanded={desktopSidebarOpen}
              title={desktopSidebarOpen ? i18n.t("收起侧边栏") : i18n.t("展开侧边栏")}
            >
              {desktopSidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </ListItemButton>
          ) : null}
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0 w-full" inert={isMobile && mobileNavOpen}>
        <header className="console-topbar">
          <div className="console-topbar-location flex items-center gap-2 min-w-0">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                ref={mobileMenuButtonRef}
                onClick={toggleSidebar}
                aria-label={mobileNavOpen ? i18n.t("关闭菜单") : i18n.t("打开菜单")}
                aria-expanded={mobileNavOpen}
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : null}
            <nav aria-label={i18n.t("当前位置")} className="console-breadcrumb">
              {!onHome && groupLabel !== currentLabel && groupLabel !== parentLabel ? <><span className="console-breadcrumb-group">{groupLabel}</span><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
              {navigation.parent && parentLabel !== currentLabel ? <><Link className="console-breadcrumb-link" to={navigation.parent.path}>{parentLabel}</Link><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
              <span aria-current="page" className="console-breadcrumb-current">{currentLabel}</span>
            </nav>
          </div>

          <div className="console-topbar-search">
            <ConsoleCommandCenter routes={routes} />
          </div>

          <div className="console-topbar-actions">
            <span
              className={cn("console-topbar-live-pill hidden sm:inline-flex", connected ? "is-online" : "is-offline")}
              title={connected ? i18n.t("Console 实时事件已连接") : i18n.t("Console 实时事件未连接")}
            >
              <span className="console-topbar-live-pill__dot" aria-hidden="true" />
              <span>{connected ? i18n.t("实时已连") : i18n.t("连接断开")}</span>
            </span>
            <LanguageSelect />
            <ThemeToggle />
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
