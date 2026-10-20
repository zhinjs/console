const declarationKeys = new Set(['configVersion', 'plugins', 'disable_plugins'])
/** Include unknown saved sections for diagnosis; only Host-provided paths authorize writes. */
export function configSectionKeys(config, configKeys) {
  return [...new Set([...configKeys, ...Object.keys(config)])].filter(key => !declarationKeys.has(key))
}
export function resolveConfigSection(section, configKeys) {
  if (section === 'yaml' || section === 'declarations' ||
      (section.startsWith('plugin:') && configKeys.includes(section.slice(7)))) return section
  return configKeys.length ? `plugin:${configKeys[0]}` : 'declarations'
}
