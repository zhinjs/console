export function readErrorSummary(error: unknown, resource: string, locale?: 'zh-CN' | 'en'): string;
export function isReadDenied(error: unknown): boolean;
export function shouldShowMissingEnv(input: {loaded: boolean; exists: boolean | undefined; dirty: boolean; readFailed: boolean}): boolean;
