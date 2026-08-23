import { useMemo, useState, useEffect, useSyncExternalStore } from "react"
import { Outlet, Link, useLocation, matchPath } from "react-router-dom"
import { Menu, LogOut, X } from "lucide-react"
import { app, cn, useWebSocket, type ConsoleRouteRecord } from "@zhin.js/client"
import { getSidebarLucideIcon } from "../components/sidebarMenuIcons"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button, buttonVariants } from "../components/ui/button"
import { ScrollArea } from "../components/ui/scroll-area"
import { Separator } from "../components/ui/separator"
import { notifyAuthRequired } from "../utils/auth"
import { isDemoMode } from "../utils/demo-mode"
import { reopenDemoOnboarding } from "../components/DemoOnboarding"
import { ConsoleCommandCenter } from "../components/ConsoleCommandCenter"
import { NAV_GROUP_ORDER, NAV_GROUPS } from "../navigation-taxonomy"

const MOBILE_MQ = "(max-width: 767px)"

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
  const location = useLocation()
  const isMobile = useIsMobile()
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const { connected } = useWebSocket()

  const showLabels = isMobile || desktopSidebarOpen

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
  const currentRoute = useMemo(
    () => menuRoutes.find((route) => (
      location.pathname === route.path || location.pathname.startsWith(`${route.path}/`)
    )),
    [location.pathname, menuRoutes],
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
    else setDesktopSidebarOpen((v) => !v)
  }

  return (
    <div className="console-app-shell flex h-[100dvh] bg-background overflow-hidden">
      <a href="#console-main-content" className="console-skip-link">跳到主要内容</a>
      {isMobile && mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 border-0 cursor-default"
          aria-label="关闭菜单"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "console-sidebar flex flex-col border-r border-[var(--console-border-subtle)] bg-sidebar",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-50 w-[min(16rem,88vw)] max-w-[88vw] shadow-lg transition-transform duration-300 ease-out",
                mobileNavOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
              )
            : cn(
                "relative shrink-0 transition-[width] duration-300",
                desktopSidebarOpen ? "w-64" : "w-16",
              ),
        )}
        aria-hidden={isMobile && !mobileNavOpen}
      >
        <div className="p-4 border-b border-[var(--console-border-subtle)]">
          <div
            className={cn(
              "flex items-center transition-all duration-300",
              showLabels ? "gap-3" : "justify-center",
            )}
          >
            <div className="console-brand-mark" aria-hidden="true">
              <span>Z</span>
            </div>
            {showLabels && (
              <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-base font-semibold truncate">
                    {isDemoMode() ? "Zhin.js Demo" : "Zhin.js"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isDemoMode() ? "零安装 Sandbox" : "Bot 工作台"}
                  </span>
                </div>
                {isMobile ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="关闭菜单"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-3">
            {orderedGroups.map((groupName) => {
              const items = menuByGroup.get(groupName) ?? []
              if (!items.length) return null
              return (
                <div key={groupName} className="space-y-1">
                  {showLabels && (
                    <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/75">
                      {groupName}
                    </div>
                  )}
                  {items.map((route, index) => {
                    const itemKey = route.path || `menu-item-${groupName}-${index}`
                    const isActive = activeMenu === itemKey || location.pathname === route.path || location.pathname.startsWith(route.path + "/")
                    return (
                      <Link
                        key={itemKey}
                        to={route.path}
                        onClick={() => {
                          setActiveMenu(itemKey)
                          if (isMobile) setMobileNavOpen(false)
                        }}
                        className={cn(
                          "menu-item",
                          isActive && "active",
                          !showLabels && "justify-center px-2",
                        )}
                      >
                        <span className="shrink-0">
                          <SidebarMenuIcon icon={route.icon} />
                        </span>
                        {showLabels && <span className="truncate">{route.name}</span>}
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0 w-full">
        <header className="console-topbar flex items-center justify-between h-14 px-3 sm:px-5 border-b border-[var(--console-border-subtle)] bg-background/88 backdrop-blur-xl shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={isMobile ? (mobileNavOpen ? "关闭菜单" : "打开菜单") : "切换侧边栏"}
              aria-expanded={isMobile ? mobileNavOpen : desktopSidebarOpen}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm font-semibold truncate">
                {currentRoute?.name ?? (isDemoMode() ? "在线 Demo" : "工作台")}
              </h2>
              <span className="text-xs text-muted-foreground truncate hidden sm:block">
                {isDemoMode()
                  ? "hello · card · ai:"
                  : currentRoute?.meta?.group ?? "管理你的 Zhin Bot"}
              </span>
            </div>
          </div>

          <div className="flex flex-1 max-w-lg mx-1 sm:mx-4">
            <ConsoleCommandCenter routes={menuRoutes} />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span
              className={cn("console-connection-state", connected ? "is-online" : "is-offline")}
              title={connected ? "Console 实时事件已连接" : "Console 实时事件未连接"}
              aria-label={connected ? "Console 实时事件已连接" : "Console 实时事件未连接"}
              role="status"
            >
              <span aria-hidden="true" />
              <span className="hidden xl:inline">{connected ? "实时" : "离线"}</span>
            </span>
            {isDemoMode() ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex text-xs"
                  onClick={() => reopenDemoOnboarding()}
                >
                  使用说明
                </Button>
                <a
                  href="https://zhin.js.org/getting-started/first-run"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs h-8 px-2.5")}
                >
                  <span className="sm:hidden">部署</span>
                  <span className="hidden sm:inline">部署到本机</span>
                </a>
                <a
                  href="https://zhin.js.org/adapters/icqq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs h-8 px-2.5 hidden sm:inline-flex")}
                >
                  接 QQ Bot
                </a>
              </>
            ) : null}
            <ThemeToggle />
            {!isDemoMode() ? (
            <Button
              variant="ghost"
              size="icon"
              title="退出登录"
              aria-label="退出登录"
              onClick={() => {
                notifyAuthRequired()
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
            ) : null}
          </div>
        </header>

        <Separator className="md:hidden" />

        <main
          id="console-main-content"
          className={cn(
            "flex-1 min-h-0 min-w-0",
            contentFlush ? "overflow-hidden flex flex-col" : "overflow-y-auto overflow-x-hidden",
          )}
        >
          <div
            className={cn(
              "mx-auto w-full min-w-0",
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
