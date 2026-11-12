import { translate } from '../i18n/locale.mjs'
export function validatePluginDetail(plugin, locale = 'zh-CN') {
  if (!plugin || typeof plugin.name !== 'string' || !plugin.name.trim() || !['active', 'inactive'].includes(plugin.status) || typeof plugin.manageable !== 'boolean' || (plugin.readOnly !== undefined && typeof plugin.readOnly !== 'boolean') || typeof plugin.packageName !== 'string' || !plugin.packageName.trim() || typeof plugin.instanceKey !== 'string' || !plugin.instanceKey.trim() || !Array.isArray(plugin.features)) throw new Error(translate(locale, "插件详情响应格式不正确"));
  for (const feature of plugin.features) {
    if (!feature || typeof feature.name !== 'string' || typeof feature.desc !== 'string' || !Number.isSafeInteger(feature.count) || feature.count < 0 || !Array.isArray(feature.items) || feature.count !== feature.items.length) throw new Error(translate(locale, "插件能力响应格式不正确"));
    for (const item of feature.items) if (!item || typeof item.name !== 'string' || (item.desc !== undefined && typeof item.desc !== 'string')) throw new Error(translate(locale, "插件能力摘要格式不正确"));
  }
}

export function pluginDiagnosticSummary(diagnostic) {
  const validation = diagnostic?.validation;
  const errors = Array.isArray(validation?.errors) ? validation.errors.map(error => typeof error === 'string' ? error : `${error?.path ?? ''} ${error?.message ?? ''}`.trim()) : [];
  const missingEnv = Array.isArray(validation?.missingEnv) ? validation.missingEnv.map(String) : [];
  const warnings = Array.isArray(diagnostic?.plan?.warnings) ? diagnostic.plan.warnings.map(String) : [];
  const status = validation?.valid === false || errors.length ? 'invalid' : missingEnv.length ? 'missing-env' : validation?.schemaAvailable === false ? 'unknown' : validation?.valid === true ? 'valid' : 'unknown';
  return {status, errors, missingEnv, warnings};
}

/**
 * Which body the detail page shows. Only the first read (no plugin yet) uses the skeleton
 * or the full-page error; once data is shown, refreshes keep it and errors become a notice.
 */
export function pluginDetailView({ loading, plugin, error }) {
  if (plugin) return { view: 'content', staleError: error || null };
  return { view: loading ? 'skeleton' : 'error', staleError: null };
}
