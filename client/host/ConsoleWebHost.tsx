import { useI18n } from '../../console-ui/src/i18n'
import * as React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { loadConsoleEntries } from "../bootstrap/loadConsoleEntries";
import { ConsoleView } from "../console-app/ConsoleView";
import { useConsoleRouteElements } from "../console-app/ConsoleRoutes";
import { app } from "@console/utils/console-client";
import NotFoundPage from "@console/pages/not-found";
import { resolveConsoleEntry } from "@console/bootstrap/default-entry.mjs";
import { CONSOLE_SHELL_PATH, CONSOLE_UI_LEGACY_PREFIX, normalizeShellBase } from "../paths";

const shellBase = normalizeShellBase(CONSOLE_SHELL_PATH);
const shellRoutePath = shellBase ? `${shellBase}/*` : "/*";
const legacyApiPrefix = normalizeShellBase(CONSOLE_UI_LEGACY_PREFIX);

/** 旧链接：/console/dashboard → /dashboard（独立站点）或保留 /console 前缀（与 Host 同路径部署时） */
function LegacyConsoleRedirect({ defaultHomePath }: { defaultHomePath: string }) {
  const { pathname } = useLocation();
  const rest =
    legacyApiPrefix && pathname.startsWith(`${legacyApiPrefix}/`)
      ? pathname.slice(legacyApiPrefix.length) || defaultHomePath
      : pathname.replace(/^\/console\/?/, "/") || defaultHomePath;
  return <Navigate to={rest.startsWith("/") ? rest : `/${rest}`} replace />;
}

function ShellLoading() {
  const i18n = useI18n()
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{i18n.t("加载中…")}</p>
      </div>
    </div>
  );
}

export function ConsoleWebHost() {
  const [ready, setReady] = React.useState(false);
  const registeredRoutes = useConsoleRouteElements();
  const defaultHomePath = `${shellBase}${resolveConsoleEntry(app.getRoutes())}`;

  React.useEffect(() => {
    loadConsoleEntries()
      .then(() => {
        React.startTransition(() => setReady(true));
      })
      .catch((e) => {
        console.error("[console] Entry load error:", e);
        setReady(true);
      });
  }, []);

  if (!ready) return <ShellLoading />;

  return (
    <Routes>
      {legacyApiPrefix ? (
        <>
          <Route path={legacyApiPrefix} element={<Navigate to={defaultHomePath} replace />} />
          <Route path={`${legacyApiPrefix}/*`} element={<LegacyConsoleRedirect defaultHomePath={defaultHomePath} />} />
        </>
      ) : null}
      <Route path={shellRoutePath} element={<ConsoleView />}>
        <Route index element={<Navigate to={defaultHomePath} replace />} />
        {registeredRoutes}
        <Route path="*" element={<NotFoundPage homePath={defaultHomePath} />} />
      </Route>
      <Route path="*" element={<Navigate to={defaultHomePath} replace />} />
    </Routes>
  );
}
