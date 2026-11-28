export interface FeatureDisabledState {
  readonly reason: string
  /** Localized explanation with the next step. */
  readonly description: string
}
export function featureDisabledState(data: unknown, locale?: 'zh-CN' | 'en'): FeatureDisabledState | null
/**
 * 「功能未启用」 for a failed read: a disabled-feature reply, or a 503 / error text saying the instance
 * has no Agent. Null for every other failure (network, permission, gateway): keep 「读取失败」.
 */
export function featureUnavailableState(reply: unknown, locale?: 'zh-CN' | 'en'): FeatureDisabledState | null
