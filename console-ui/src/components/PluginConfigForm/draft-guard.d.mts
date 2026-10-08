export function createConfigDraftGuard(): { edited(): void; saved(): void; receive(key: string, value: unknown): boolean };
