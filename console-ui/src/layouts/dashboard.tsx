import { routeLabel } from '../i18n/navigation'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore } from "react"
import { Outlet, Link, useLocation, matchPath } from "react-router-dom"
import { Menu, X, ChevronRight } from "lucide-react"
import { Aurora, BrandMark, Chip, cn, CONSOLE_PRODUCT_NAME, IconButton, ListItemButton, NavIcon, NavPill, ScrollArea, StatusDot, TabBar, TabBarItem } from '@zhin.js/console-ui'
import { type ConsoleRouteRecord } from "@zhin.js/client"
import { useConsoleConnected } from "../hooks/use-console-connected"
import { app } from "../utils/console-client"
import { getSidebarLucideIcon } from "../components/sidebarMenuIcons"
import { UserMenu } from "../components/UserMenu"
import { signOut } from "../utils/console-auth-api"
import { principalLabel } from "../utils/console-auth-model.mjs"
import { useConsoleSession } from "../hooks/use-console-session"
import { OnboardingBanner } from "../components/onboarding-banner"
import { InstanceUnavailableBanner } from "../components/InstanceUnavailableBanner"
import { ConnectionIndicator } from "../components/ConnectionIndicator"
import { CONSOLE_PATHS, LEGACY_ROUTE_REDIRECTS, isPluginPageRedirect } from "../console-routes.mjs"
import { objectPageOwnsBreadcrumb } from "../scope/scope-tree.mjs"
import { ConsoleCommandCenter } from "../components/ConsoleCommandCenter"
import { LogPanel, LogPanelButton, useLogPanelLayout } from "../components/log-panel/LogPanel"
import { AttentionBadge } from "../pages/attention/AttentionBadge"
import "./workspace-navigation.css"
import { resolveNavigationLocation } from "../navigation-location.mjs"
import { activeSectionId, buildNavigation, deniedRoutePermissions, navSections, routeSectionId, sectionById, sectionEntryPath, sectionLinkCurrent, sectionSubnav, tabBarModel } from "../navigation-sections.mjs"
import { StatusState } from "../components/StatusState"
import { useConsoleAccess } from "../hooks/use-console-access"

import { useIsCompactNav } from '../hooks/useIsMobile'
const HOME_PATH = "/dashboard"

function SectionIcon({ icon }: { icon?: React.ReactNode | string }) {
  if (icon == null) return null
  if (typeof icon === "string") {
    const Cmp = getSidebarLucideIcon(icon)
    return <Cmp aria-hidden="true" />
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
 * Console shell (console-ui 1.3.0 「柔光卡片」, the Main design): a top bar in the page flow — brand,
 * the six sections (the current one a black NavPill with its name, the others round NavIcons that
 * open the section's first page) and the actions — over the Aurora of a first-level page. A
 * section's pages are the Chips under the bar. Phones get the floating TabBar (four sections and
 * 「更多」, which opens the drawer with every page).
 */

export default function DashboardLayout() {
  const i18n = useI18n()
  const location = useLocation()
  const compact = useIsCompactNav()
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
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
  // A page reached by its address (a link, a bookmark, a redirect) that the menu hides for this
  // principal: the standard 无权限 panel instead of the page and its refused reads. Redirects pass.
  const deniedPermissions = navigation.current && !Object.hasOwn(LEGACY_ROUTE_REDIRECTS, navigation.current.path) && !isPluginPageRedirect(navigation.current.path)
    ? deniedRoutePermissions(navigation.current, access) : null
  const onHome = navigation.current?.path === HOME_PATH
  const navOwner = navigation.current ?? navigation.parent ?? navigation.visible
  const groupLabel = i18n.t(navOwner ? sectionById(routeSectionId(navOwner))?.label ?? navigation.group : navigation.group)
  const parentLabel = navigation.parent ? routeLabel(navigation.parent, i18n.locale) : null
  const activePath = navigation.visible?.path
  const drawerVisible = compact && drawerOpen
  // The docked log panel is non-modal (the page stays interactive); only the phone sheet makes the page inert.
  const logPanel = useLogPanelLayout()
  const pageInert = drawerVisible || logPanel.modal

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // A new page starts at its top; query-only changes (filters, tabs) keep the scroll position.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

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

  const sections = navSections(navTiers)
  const activeSection = activeSectionId(navTiers, activePath, navOwner)
  const currentSection = sections.find((section) => section.id === activeSection) ?? null
  const subnav = sectionSubnav(currentSection)
  const tabBar = tabBarModel(navTiers, activeSection)
  // A first-level page (one listed in the navigation) gets the Aurora behind the top of the page.
  const firstLevel = Boolean(navigation.current && activePath === navigation.current.path)
  // A page below its menu page (plugin detail, object pages …) keeps a breadcrumb back to it.
  const showBreadcrumb = !onHome && Boolean(navigation.current) && !firstLevel && !objectPageOwnsBreadcrumb(location.pathname)

  /**
   * Top bar: one NavPill (the current section, with its name) or NavIcon (the others) per section.
   * A section link opens the section's first page: `aria-current="page"` only there, `"true"` on the
   * section's other pages (the library NavPill defaults to `"page"`; our prop comes after it).
   */
  const barNavigation = (
    <nav className="console-topnav-nav" aria-label={i18n.t("主导航")}>
      {sections.map((section) => {
        const to = sectionEntryPath(section)
        if (!to) return null
        const label = i18n.t(section.label)
        return section.id === activeSection
          ? <NavPill key={section.id} asChild data-section={section.id} aria-current={sectionLinkCurrent(to, location.pathname)}><Link to={to}><SectionIcon icon={section.icon} />{label}</Link></NavPill>
          : <NavIcon key={section.id} asChild label={label} data-section={section.id}><Link to={to}><SectionIcon icon={section.icon} /></Link></NavIcon>
      })}
    </nav>
  )

  /**
   * The current section's pages (Chips, like the design's 聊天账号 · 模型与用途 row): links, so the
   * arrow keys never switch pages (访问控制's 用户 / 角色 / 令牌 / 审计 included).
   */
  const sectionNavigation = subnav.length ? (
    <nav className="console-section-nav" aria-label={i18n.t("{0}的页面", [i18n.t(currentSection!.label)])} data-section={currentSection!.id}>
      {subnav.map((group) => (
        <div key={group.id} className="console-section-nav-group" data-group={group.id} role={group.labelled ? "group" : undefined} aria-label={group.labelled ? i18n.t(group.label) : undefined}>
          {group.labelled && group.id !== "core" ? <span className="console-section-nav-label" aria-hidden="true">{i18n.t(group.label)}</span> : null}
          {group.routes.map((route, index) => {
            const isActive = route.path === activePath
            return (
              <Chip key={route.path || `section-${group.id}-${index}`} asChild>
                <Link to={route.path} aria-current={isActive ? "page" : undefined}>{routeLabel(route, i18n.locale)}</Link>
              </Chip>
            )
          })}
        </div>
      ))}
    </nav>
  ) : null

  /** Drawer navigation (phones, opened from 「更多」): every page listed under its tier and section. */
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
              {section.groups.map((group) => <div key={group.id} className="console-nav-subgroup" data-group={group.id}>
                {section.groups.length > 1 ? <div className="console-nav-subgroup-label">{i18n.t(group.label)}</div> : null}
                {group.routes.map((route, index) => {
                  const isActive = route.path === activePath
                  return (
                    <Link
                      key={route.path || `menu-item-${section.id}-${index}`}
                      to={route.path}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setDrawerOpen(false)}
                      className={cn("console-nav-item", isActive && "is-active")}
                    >
                      <span className="console-nav-icon" aria-hidden="true"><SectionIcon icon={route.icon} /></span>
                      <span className="truncate">{routeLabel(route, i18n.locale)}</span>
                    </Link>
                  )
                })}
              </div>)}
            </div>
          )
        })}
      </div>)}
    </nav>
  )

  return (
    <div className="console-app-shell console-aurora-host" data-wide={contentFullWidth ? "true" : undefined} data-first-level={firstLevel ? "true" : undefined}>
      {firstLevel ? <Aurora className="console-shell-aurora" /> : null}
      <a href="#console-main-content" className="console-skip-link">{i18n.t("跳到主要内容")}</a>

      <header className="console-topnav" inert={pageInert}>
        <div className="console-topnav-bar console-content-frame" data-wide={contentFullWidth ? "true" : undefined}>
          <Link to="/" className="console-brand-link" aria-label={CONSOLE_PRODUCT_NAME}>
            <BrandMark withText />
          </Link>

          {compact ? null : barNavigation}

          <div className="console-topnav-actions">
            <ConsoleCommandCenter routes={routes} />
            <LogPanelButton />
            <AttentionBadge />
            <ConnectionIndicator />
            <UserMenu accountLabel={accountLabel} accountHref={me?.user ? CONSOLE_PATHS.account : undefined} onSignOut={() => { void signOut(me) }} />
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
            <Link to="/" className="console-brand-link" aria-label={CONSOLE_PRODUCT_NAME} onClick={() => setDrawerOpen(false)}>
              <BrandMark withText />
            </Link>
            <IconButton variant="flat" className="shrink-0" onClick={() => setDrawerOpen(false)} aria-label={i18n.t("关闭菜单")}>
              <X aria-hidden="true" />
            </IconButton>
          </div>
          <ScrollArea className="flex-1 min-h-0">{drawerNavigation}</ScrollArea>
          <div className="console-nav-drawer-footer">
            <span title={connectionTitle} role="status"><StatusDot tone={connected ? "neutral" : "warn"}>
              {connected ? i18n.t("实时事件已连接") : i18n.t("实时事件未连接")}
            </StatusDot></span>
            <LanguageSelect />
          </div>
        </aside>
      ) : null}

      <main
        id="console-main-content"
        className="console-main-scroll"
        inert={pageInert}
      >
        <div
          className={cn(
            "console-main mx-auto w-full min-w-0",
            contentFullWidth ? "max-w-none" : "console-content-frame",
          )}
        >
          <InstanceUnavailableBanner />
          <OnboardingBanner />
          {sectionNavigation}
          {/* Object pages below 全局 render their own scope breadcrumb; one breadcrumb per page. An address no
              page matches gets none: the not-found page names the address itself (console#125). */}
          {showBreadcrumb ? <nav aria-label={i18n.t("当前位置")} className="console-breadcrumb">
            {!subnav.length && groupLabel !== currentLabel && groupLabel !== parentLabel ? <><span className="console-breadcrumb-group">{groupLabel}</span><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
            {navigation.parent && parentLabel !== currentLabel ? <><Link className="console-breadcrumb-link" to={navigation.parent.path}>{parentLabel}</Link><ChevronRight aria-hidden="true" className="console-breadcrumb-sep" /></> : null}
            <span aria-current="page" className="console-breadcrumb-current">{currentLabel}</span>
          </nav> : null}
          <div key={location.pathname} className="console-route-view">
            {deniedPermissions ? <StatusState kind="forbidden" permissions={deniedPermissions} /> : <Outlet />}
          </div>
        </div>
      </main>

      {compact ? (
        <TabBar floating aria-label={i18n.t("主导航")} className="console-shell-tabbar" inert={pageInert}>
          {tabBar.tabs.map((section) => {
            const to = sectionEntryPath(section)
            if (!to) return null
            return (
              <TabBarItem key={section.id} asChild icon={null} current={section.id === activeSection} data-section={section.id}>
                <Link to={to} aria-current={section.id === activeSection ? sectionLinkCurrent(to, location.pathname) : undefined}><SectionIcon icon={section.icon} />{i18n.t(section.label)}</Link>
              </TabBarItem>
            )
          })}
          <TabBarItem asChild icon={null} current={tabBar.moreActive || drawerOpen}>
            <button type="button" ref={menuButtonRef} onClick={() => setDrawerOpen((v) => !v)} aria-expanded={drawerOpen} aria-current={undefined} data-active={tabBar.moreActive ? "true" : undefined}>
              <Menu aria-hidden="true" />{i18n.t("更多")}
            </button>
          </TabBarItem>
        </TabBar>
      ) : null}

      {/* Mounted once for every page; opened from the top bar, Ctrl + `, the command center or openLogPanel(). */}
      <LogPanel />
    </div>
  )
}
