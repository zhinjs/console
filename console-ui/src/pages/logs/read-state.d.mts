export function logReadState(input: {readOnly: boolean; loaded: boolean; error: string | null; statsError: string | null; stats: {total: number} | null}): {logsKnown: boolean; total: number | string; canManage: boolean};
export function logPayloadAvailability(payload: {note?: unknown}): {available: boolean; message: string | null};
