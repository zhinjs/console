import { LocaleProvider } from '@console/i18n'
import { useI18n } from '../console-ui/src/i18n'
import "./style.css";
import * as React from "react";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactRouterDOM from "react-router-dom";
import {
  CONSOLE_HOST_REACT_NAMESPACE_KEY,
  CONSOLE_SHARED_MODULES_KEY,
} from "@zhin.js/contract";
import { ConsoleClientProvider, useConsoleTransport } from "@zhin.js/client";
import { getConsoleClient } from "@console/utils/console-client";
import { resetConsoleRuntime } from "@console/utils/console-runtime";
import { BrowserRouter } from "react-router-dom";
import { getRouterBasename } from "./pagesBase";
import { ConsoleWebHost } from "./host/ConsoleWebHost";
import { registerBuiltinConsolePages } from "@console/registerBuiltinShell";
import { initializeTheme } from "@console/theme";
import LoginPage from "@console/pages/login";
import { TooltipProvider } from "@console/components/ui/tooltip";
import { ToastProvider } from "@console/components/toast";
import { runQueryPrefillMiddleware } from "./middleware/queryPrefill";
import { runDemoBootstrap } from "./middleware/demoBootstrap";
import { isDemoMode } from "@console/utils/demo-mode";

initializeTheme();

const consoleHostReactNamespace = Object.assign(
  Object.create(null),
  React,
  ReactJsxRuntime,
  ReactJsxDevRuntime,
);
(globalThis as Record<string, unknown>)[CONSOLE_HOST_REACT_NAMESPACE_KEY] =
  consoleHostReactNamespace;

const sharedModules = new Map<string, unknown>();
sharedModules.set("react", React);
sharedModules.set("react/jsx-runtime", ReactJsxRuntime);
sharedModules.set("react/jsx-dev-runtime", ReactJsxDevRuntime);
sharedModules.set("react-dom", ReactDOM);
sharedModules.set("react-dom/client", ReactDOMClient);
sharedModules.set("react-router", ReactRouterDOM);
sharedModules.set("react-router-dom", ReactRouterDOM);
(globalThis as Record<string, unknown>)[CONSOLE_SHARED_MODULES_KEY] = sharedModules;

registerBuiltinConsolePages();

const demoSession = runDemoBootstrap();
const initialSession = demoSession ?? runQueryPrefillMiddleware();

function ConsoleConnection() {
  useConsoleTransport();
  return <ConsoleWebHost />;
}

function ConsoleShell() {
  // The shell only mounts while signed in; a 401 unmounts it, so each mount sees the session's client.
  const [client] = React.useState(getConsoleClient);
  return (
    <ConsoleClientProvider client={client}>
      <ConsoleConnection />
    </ConsoleClientProvider>
  );
}

function App() {
  const i18n = useI18n()
  const [authed, setAuthed] = React.useState(initialSession.authed);
  const loginApiBase = initialSession.loginApiBase;
  const handleLogin = React.useCallback(() => setAuthed(true), []);

  React.useEffect(() => {
    const onAuthRequired = () => {
      resetConsoleRuntime();
      setAuthed(false);
    };
    window.addEventListener("zhin:auth-required", onAuthRequired);
    return () => window.removeEventListener("zhin:auth-required", onAuthRequired);
  }, []);

  if (!authed) {
    if (isDemoMode()) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-6">
          <p className="text-sm text-destructive text-center max-w-md">
            {i18n.t("演示 Host 拒绝了预置令牌，或暂时不可用。请稍后刷新重试。")}</p>
        </div>
      );
    }
    return (
      <LoginPage onSuccess={handleLogin} initialApiBase={loginApiBase} />
    );
  }

  return <ConsoleShell />;
}

ReactDOMClient.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
    <TooltipProvider>
      <ToastProvider>
        <BrowserRouter
        basename={getRouterBasename()}
      >
        <App />
      </BrowserRouter>
      </ToastProvider>
    </TooltipProvider>
  </LocaleProvider>
  </React.StrictMode>,
);
