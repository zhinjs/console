import * as React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { loadConsoleEntries } from "../bootstrap/loadConsoleEntries";
import { ConsoleView } from "../console-app/ConsoleView";
import { useConsoleRouteElements } from "../console-app/ConsoleRoutes";
import { CONSOLE_API_PATH, CONSOLE_SHELL_PATH, normalizeShellBase } from "../paths";

const shellBase = normalizeShellBase(CONSOLE_SHELL_PATH);
const shellRoutePath = shellBase ? `${shellBase}/*` : "/*";
const dashboardPath = `${shellBase || ""}/dashboard`.replace(/^\/\//, "/");
const legacyApiPrefix = normalizeShellBase(CONSOLE_API_PATH);

/** 旧链接：/console/dashboard → /dashboard（独立站点）或保留 /console 前缀（与 Host 同路径部署时） */
function LegacyConsoleRedirect() {
  const { pathname } = useLocation();
  const rest =
    legacyApiPrefix && pathname.startsWith(`${legacyApiPrefix}/`)
      ? pathname.slice(legacyApiPrefix.length) || "/dashboard"
      : pathname.replace(/^\/console\/?/, "/") || "/dashboard";
  return <Navigate to={rest.startsWith("/") ? rest : `/${rest}`} replace />;
}

function ShellLoading() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
      </div>
    </div>
  );
}

function DashboardHome() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <h1 className="text-2xl font-semibold mb-2 text-foreground">Zhin Console</h1>
      <p className="text-sm">从侧栏选择一个页面，或安装注册控制台路由的插件。</p>
    </div>
  );
}

export function ConsoleWebHost() {
  const [ready, setReady] = React.useState(false);
  const registeredRoutes = useConsoleRouteElements();

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
          <Route path={legacyApiPrefix} element={<Navigate to={dashboardPath} replace />} />
          <Route path={`${legacyApiPrefix}/*`} element={<LegacyConsoleRedirect />} />
        </>
      ) : null}
      <Route path={shellRoutePath} element={<ConsoleView />}>
        <Route index element={<Navigate to={dashboardPath} replace />} />
        {registeredRoutes}
        <Route path="*" element={<DashboardHome />} />
      </Route>
      <Route path="*" element={<Navigate to={dashboardPath} replace />} />
    </Routes>
  );
}
