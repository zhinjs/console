import { Languages } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'

export function LanguageSelect() {
  const i18n = useI18n()
  const { locale, setLocale, t } = useI18n()
  return <label className="console-language-select">
    <Languages aria-hidden="true" />
    <span className="sr-only">{t(i18n.t("界面语言"))}</span>
    <select value={locale}
      onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value) }}>
      <option value="zh-CN">{i18n.t("简体中文")}</option><option value="en">English</option>
    </select>
  </label>
}
