import * as React from "react";
import { Route } from "react-router-dom";
import { app } from "@zhin.js/client";
import { CONSOLE_API_PATH } from "../paths";

const routePathPrefix = CONSOLE_API_PATH.endsWith("/")
  ? CONSOLE_API_PATH
  : `${CONSOLE_API_PATH}/`;

function toRelativeRoutePath(abs: string): string {
  if (abs.startsWith(routePathPrefix)) return abs.slice(routePathPrefix.length);
  if (abs === CONSOLE_API_PATH) return "";
  return abs.startsWith("/") ? abs.slice(1) : abs;
}

export function useConsoleRouteElements(): React.ReactElement {
  const v = React.useSyncExternalStore(app.subscribe, app.getVersion, app.getVersion);
  void v;
  const routeRecords = app._getRoutes();

  return (
    <>
      {routeRecords.map((r) => (
        <Route key={r.path} path={toRelativeRoutePath(r.path)} element={app._renderRouteElement(r)} />
      ))}
    </>
  );
}
