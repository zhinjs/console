// Preloaded by `pnpm test` (`node --import`): the English catalog is loaded on demand in the app
// (#64 `english-catalog-lazy`), while tests call `translate('en', …)` synchronously.
import { installEnglishCatalog } from '../../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../../console-ui/src/i18n/messages.en.mjs'

installEnglishCatalog(englishMessages)
