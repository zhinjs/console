export function validatePluginDetail(plugin) {
  if (!plugin || typeof plugin.name !== 'string' || !plugin.name.trim() || !['active', 'inactive'].includes(plugin.status) || typeof plugin.manageable !== 'boolean' || (plugin.readOnly !== undefined && typeof plugin.readOnly !== 'boolean') || typeof plugin.packageName !== 'string' || !plugin.packageName.trim() || typeof plugin.instanceKey !== 'string' || !plugin.instanceKey.trim() || !Array.isArray(plugin.features)) throw new Error('插件详情响应格式不正确');
  for (const feature of plugin.features) {
    if (!feature || typeof feature.name !== 'string' || typeof feature.desc !== 'string' || !Number.isSafeInteger(feature.count) || feature.count < 0 || !Array.isArray(feature.items) || feature.count !== feature.items.length) throw new Error('插件能力响应格式不正确');
    for (const item of feature.items) if (!item || typeof item.name !== 'string' || (item.desc !== undefined && typeof item.desc !== 'string')) throw new Error('插件能力摘要格式不正确');
  }
}

export function requirePluginUpdate(payload, packageName) {
  if (payload?.success !== true || !Array.isArray(payload.data)) {
    throw new Error('版本查询响应格式不正确。');
  }
  const update = payload.data.find(item => item && item.name === packageName);
  if (!update || typeof update.latest !== 'string' || !update.latest.trim()) {
    throw new Error('未获取到此插件的版本信息，请稍后重试。');
  }
  return update;
}

export function pluginDiagnosticSummary(diagnostic) {
  const validation = diagnostic?.validation;
  const errors = Array.isArray(validation?.errors) ? validation.errors.map(error => typeof error === 'string' ? error : `${error?.path ?? ''} ${error?.message ?? ''}`.trim()) : [];
  const missingEnv = Array.isArray(validation?.missingEnv) ? validation.missingEnv.map(String) : [];
  const warnings = Array.isArray(diagnostic?.plan?.warnings) ? diagnostic.plan.warnings.map(String) : [];
  const status = validation?.valid === false || errors.length ? 'invalid' : missingEnv.length ? 'missing-env' : validation?.valid === true ? 'valid' : 'unknown';
  return {status, errors, missingEnv, warnings};
}
