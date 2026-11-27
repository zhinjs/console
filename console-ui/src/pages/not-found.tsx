import { Link, useLocation } from 'react-router-dom'
import { Home, Search } from 'lucide-react'
import { Button, EmptyIllustration } from '@zhin.js/console-ui'
import { useI18n } from '../i18n'
import { commandCenterShortcut, openCommandCenter } from '../components/ConsoleCommandCenter'
import './not-found.css'

/**
 * An address no registered page matches (e.g. an old link or a plugin page that is not installed).
 * It says so plainly, shows the address, and offers the two ways on: home (the view's primary), or
 * search with ⌘K.
 */
export default function NotFoundPage({ homePath }: { homePath: string }) {
  const i18n = useI18n()
  const location = useLocation()
  const address = `${location.pathname}${location.search}`
  return (
    <section className="console-not-found" aria-labelledby="console-not-found-title">
      {/* The library's not-found line art (ADR 0063 D28); the page keeps its own h1, address and two ways on. */}
      <EmptyIllustration name="not-found" className="console-empty-art" />
      <h1 id="console-not-found-title">{i18n.t('找不到这个页面')}</h1>
      <p>{i18n.t('Console 里没有这个地址对应的页面。链接可能已过期，或者提供它的插件没有安装。')}</p>
      <code className="console-not-found-address">{address}</code>
      <div className="console-not-found-actions">
        <Button variant="primary" asChild><Link to={homePath}><Home />{i18n.t('返回首页')}</Link></Button>
        <Button type="button" variant="secondary" onClick={() => openCommandCenter()}><Search />{i18n.t('打开 {0} 搜索', [commandCenterShortcut().replace('⌘ K', '⌘K')])}</Button>
      </div>
    </section>
  )
}
