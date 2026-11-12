export function validatePluginDetail(plugin: unknown, locale?: 'zh-CN' | 'en'): void;
export function pluginDiagnosticSummary(diagnostic: unknown): { status: 'invalid' | 'missing-env' | 'valid' | 'unknown'; errors: string[]; missingEnv: string[]; warnings: string[] };
export function pluginDetailView(input: { loading: boolean; plugin: unknown; error: string | null }): { view: 'skeleton' | 'error' | 'content'; staleError: string | null };
