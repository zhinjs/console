export function generalConfigKeys(config, configKeys) {
  const excluded = new Set([...configKeys, 'plugins'])
  return Object.keys(config).filter(key => !excluded.has(key))
}

export function resolveConfigSection(section, configKeys, hasGeneral) {
  if (section === 'yaml' || (section === 'general' && hasGeneral) ||
      (section.startsWith('plugin:') && configKeys.includes(section.slice(7)))) return section
  return hasGeneral ? 'general' : configKeys.length ? `plugin:${configKeys[0]}` : 'yaml'
}
