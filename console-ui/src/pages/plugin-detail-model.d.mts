export function validatePluginDetail(plugin: unknown, locale?: 'zh-CN' | 'en'): void;
export function requirePluginUpdate(payload: unknown, packageName: string, locale?: 'zh-CN' | 'en'): { name: string; latest: string; current?: string };
export function pluginDiagnosticSummary(diagnostic: unknown): { status: 'invalid' | 'missing-env' | 'valid' | 'unknown'; errors: string[]; missingEnv: string[]; warnings: string[] };
export function pluginDetailView(input: { loading: boolean; plugin: unknown; error: string | null }): { view: 'skeleton' | 'error' | 'content'; staleError: string | null };
