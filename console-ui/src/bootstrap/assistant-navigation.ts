import { createOptionalNavigation } from './optional-navigation.mjs'
import type { app } from '@zhin.js/client'
export const assistantNavigation = createOptionalNavigation<Parameters<typeof app.addRoute>[0]>()
