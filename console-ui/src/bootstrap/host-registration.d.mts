export function createHostRegistration<Route extends {path: string}, Tool>(options: {
  addRoute(input: Route): void;
  removeRoute(path: string): void;
  readRoutes(): readonly Route[];
  addTool(input: Tool): string;
  removeTool?: (id: string) => void;
}): {capture(): {active(): boolean; addRoute(input: Route): void; addTool(input: Tool): string}; reset(): void};
