export interface FeatureDisabledState {
  readonly reason: string
  /** Localized explanation with the next step. */
  readonly description: string
}
export function featureDisabledState(data: unknown, locale?: 'zh-CN' | 'en'): FeatureDisabledState | null
