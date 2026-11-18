import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { routeLabel } from '../i18n/navigation'
import { app } from '../utils/console-client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@zhin.js/console-ui'
import { PLUGIN_OVERVIEW_TAB, pluginDetailPath, pluginTabsOf, type PluginTabMeta } from '../plugin-pages.mjs'

const readRoutes = () => app.getRoutes()

/**
 * The plugin detail page's tabs (ADR 0063 决策 3, ADR 0062 第 24 项): 概览 plus one tab per page the
 * plugin contributes. Each tab is its own URL (`/plugins/<plugin>` and `/plugins/<plugin>/<page>`), so
 * the selected tab survives reloads, links and the back button. Only the open tab is mounted. A
 * plugin without pages shows its 概览 without a tab bar.
 */
export function PluginPageTabs({ plugin, names, active, overview, page }: {
  /** The plugin as the URL names it (`/plugins/:name`). */
  plugin: string
  /** Every identifier the plugin is known by (route name, instance key, package name). */
  names: readonly (string | null | undefined)[]
  /** `overview`, or the open page's path. */
  active: string
  overview: ReactNode
  page?: ReactNode
}) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const routes = useSyncExternalStore(app.subscribe, readRoutes, readRoutes)
  const key = names.filter(Boolean).join('\n')
  const tabs = useMemo(() => pluginTabsOf(routes, key.split('\n')), [routes, key])
  const content = active === PLUGIN_OVERVIEW_TAB ? overview : page
  if (!tabs.length && active === PLUGIN_OVERVIEW_TAB) return <>{overview}</>
  // The plugin list's search travels along, so 返回插件 still returns to the filtered list.
  const query = searchParams.get('q')
  const open = (path: string) => navigate(query ? `${path}?q=${encodeURIComponent(query)}` : path)
  return (
    <Tabs value={active} onValueChange={value => open(value === PLUGIN_OVERVIEW_TAB ? pluginDetailPath(plugin) : value)} className="console-plugin-tabs">
      <div className="console-object-tablist-scroll">
        <TabsList aria-label={i18n.t('插件页签')}>
          <TabsTrigger value={PLUGIN_OVERVIEW_TAB} className="console-object-tab">{i18n.t('概览')}</TabsTrigger>
          {tabs.map(route => (
            <TabsTrigger key={route.path} value={(route.meta as { pluginTab?: PluginTabMeta } | undefined)?.pluginTab?.href ?? route.path} className="console-object-tab">{routeLabel(route, i18n.locale)}</TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value={active} className="console-plugin-tab-panel">{content}</TabsContent>
    </Tabs>
  )
}
