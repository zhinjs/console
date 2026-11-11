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
import { ToastProvider, useToast } from "@console/components/toast";
import { runQueryPrefillMiddleware, takeLoginLink, type InitialSession } from "./middleware/queryPrefill";

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

// Removes `#token=` (and a rejected `?token=`) from the address bar before anything else.
const loginLink = takeLoginLink();
const initialSession: InitialSession = runQueryPrefillMiddleware(loginLink);

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
  // Used for one sign-in attempt only; a later sign-out must not retry the link token.
  const [linkToken, setLinkToken] = React.useState(initialSession.loginToken);
  const handleLogin = React.useCallback(() => {
    // The login page already showed the `?token=` notice; do not repeat it as a toast or after a sign-out.
    initialSession.queryTokenRejected = false;
    setAuthed(true);
  }, []);
  const consumeLinkToken = React.useCallback(() => {
    initialSession.loginToken = null;
    setLinkToken(null);
  }, []);
  const toast = useToast();

  // Signed in already: the login page cannot show why a `?token=` was ignored, so say it here once.
  React.useEffect(() => {
    if (!authed || !initialSession.queryTokenRejected) return;
    initialSession.queryTokenRejected = false;
    toast.warning(i18n.t("token 不能放在 ? 参数里：它已从地址栏移除且未被使用。"));
  }, [authed, toast, i18n]);

  React.useEffect(() => {
    const onAuthRequired = () => {
      resetConsoleRuntime();
      setAuthed(false);
    };
    window.addEventListener("zhin:auth-required", onAuthRequired);
    return () => window.removeEventListener("zhin:auth-required", onAuthRequired);
  }, []);

  if (!authed) {
    return (
      <LoginPage onSuccess={handleLogin} initialApiBase={loginApiBase}
        initialToken={linkToken} onInitialTokenConsumed={consumeLinkToken}
        queryTokenRejected={initialSession.queryTokenRejected} />
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
