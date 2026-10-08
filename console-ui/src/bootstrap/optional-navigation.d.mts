export function createOptionalNavigation<T extends { meta?: Record<string, unknown> } >(): {
 bind(session: {active(): boolean; addRoute(route: T): void}, route: T, available: boolean): void;
 capture(): (available: boolean) => void;
 reset(): void;
}
