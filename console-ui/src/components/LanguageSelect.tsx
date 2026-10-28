import { Languages } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLocale } from '../i18n/locale.mjs'
import { SelectField } from './ui/select'

export function LanguageSelect() {
  const i18n = useI18n()
  const { locale, setLocale, t } = useI18n()
  return <label className="console-language-select">
    <Languages aria-hidden="true" />
    <span className="sr-only">{t(i18n.t("界面语言"))}</span>
    <SelectField className="h-8 w-auto shrink-0 gap-1 border-0 bg-transparent py-0 pl-7 pr-1.5 text-xs text-muted-foreground hover:bg-accent max-sm:h-9 max-sm:w-9 max-sm:p-0 max-sm:[&>span]:sr-only max-sm:[&>svg]:hidden" aria-label={i18n.t("界面语言")} value={locale}
      onValueChange={value => { if (isLocale(value)) setLocale(value) }}
      options={[{ value: 'zh-CN', label: i18n.t("简体中文") }, { value: 'en', label: 'English' }]} />
  </label>
}
