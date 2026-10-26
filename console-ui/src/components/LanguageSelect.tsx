import { Languages } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'

export function LanguageSelect() {
  const i18n = useI18n()
  const { locale, setLocale, t } = useI18n()
  return <label className="inline-flex shrink-0 items-center gap-2 text-sm">
    <Languages aria-hidden="true" className="h-4 w-4" />
    <span className="sr-only">{t(i18n.t("界面语言"))}</span>
    <select className="max-w-32 rounded-md border bg-background px-2 py-1.5 text-foreground" value={locale}
      onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value) }}>
      <option value="zh-CN">{i18n.t("简体中文")}</option><option value="en">English</option>
    </select>
  </label>
}
