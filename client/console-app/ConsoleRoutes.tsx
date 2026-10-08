import * as React from "react";
import { Route } from "react-router-dom";
import { app } from "@zhin.js/client";
import { PageErrorBoundary } from "@console/components/page-error-boundary";

function RouteContent({ route }: { route: ReturnType<typeof app._getRoutes>[number] }) {
  return <>{app._renderRouteElement(route)}</>;
}
import { CONSOLE_UI_LEGACY_PREFIX } from "../paths";

const routePathPrefix = CONSOLE_UI_LEGACY_PREFIX.endsWith("/")
  ? CONSOLE_UI_LEGACY_PREFIX
  : `${CONSOLE_UI_LEGACY_PREFIX}/`;

function toRelativeRoutePath(abs: string): string {
  if (abs.startsWith(routePathPrefix)) return abs.slice(routePathPrefix.length);
  if (abs === CONSOLE_UI_LEGACY_PREFIX) return "";
  return abs.startsWith("/") ? abs.slice(1) : abs;
}

export function useConsoleRouteElements(): React.ReactElement {
  const v = React.useSyncExternalStore(app.subscribe, app.getVersion, app.getVersion);
  void v;
  const routeRecords = app._getRoutes();

  return (
    <>
      {routeRecords.map((r) => (
        <Route key={r.path} path={toRelativeRoutePath(r.path)} element={<PageErrorBoundary key={r.path}><RouteContent route={r} /></PageErrorBoundary>} />
      ))}
    </>
  );
}
