export function logReadState(input: {readOnly: boolean; loaded: boolean; error: string | null; statsError: string | null; stats: {total: number} | null}): {logsKnown: boolean; total: number | string; canManage: boolean};
export function logPayloadAvailability(payload: {note?: unknown}, locale?: 'zh-CN' | 'en'): {available: boolean; message: string | null};
/** Whether the identity may clean up / clear logs (DELETE /logs, POST /logs/cleanup per the protocol), and what it lacks. */
export function logManageAccess(has: (permission: string) => boolean): { allowed: boolean; missing: string[] };
