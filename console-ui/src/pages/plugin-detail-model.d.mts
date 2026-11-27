export function validatePluginDetail(plugin: unknown, locale?: 'zh-CN' | 'en'): void;
export function pluginDiagnosticSummary(diagnostic: unknown): { status: 'invalid' | 'missing-env' | 'valid' | 'unknown'; errors: string[]; missingEnv: string[]; warnings: string[] };
export function pluginDetailView(input: { loading: boolean; plugin: unknown; error: string | null }): { view: 'skeleton' | 'error' | 'content'; staleError: string | null };
/** A gateway package the instance does not report: a plugin waiting for configuration, or a dependency. */
export function detailPackageState(input: { plugin: unknown; entry: { name: string; kind?: string; catalog?: string } | null | undefined; detailStatus: number | undefined }): 'undeclared' | 'dependency' | null;
