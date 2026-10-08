export function validatePluginDetail(plugin: unknown): void;
export function requirePluginUpdate(payload: unknown, packageName: string): { name: string; latest: string; current?: string };
export function pluginDiagnosticSummary(diagnostic: unknown): { status: 'invalid' | 'missing-env' | 'valid' | 'unknown'; errors: string[]; missingEnv: string[]; warnings: string[] };
