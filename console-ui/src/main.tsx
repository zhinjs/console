import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import * as ReactRouterDOM from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import {
  CONSOLE_HOST_REACT_NAMESPACE_KEY,
  CONSOLE_SHARED_MODULES_KEY,
} from '@zhin.js/contract'
import { app, useWebSocket } from '@zhin.js/client'
import { loadConsoleEntries } from './bootstrap'
import { registerBuiltinConsolePages } from './registerBuiltinShell'
import LoginPage from './pages/login'
import DashboardLayout from './layouts/dashboard'
import { hasToken } from './utils/auth'
import { resetConsoleRuntime } from './utils/console-runtime'
import { registerOptionalConsoleRoutes } from './registerOptionalRoutes'
import './style.css'
import { initializeTheme } from './theme'
import { TooltipProvider } from './components/ui/tooltip'
import { ToastProvider } from './components/toast'

initializeTheme()

const consoleHostReactNamespace = Object.assign(
  Object.create(null),
  React,
  ReactJsxRuntime,
  ReactJsxDevRuntime,
)
;(globalThis as Record<string, unknown>)[CONSOLE_HOST_REACT_NAMESPACE_KEY] =
  consoleHostReactNamespace

const sharedModules = new Map<string, unknown>()
sharedModules.set('react', React)
sharedModules.set('react/jsx-runtime', ReactJsxRuntime)
sharedModules.set('react/jsx-dev-runtime', ReactJsxDevRuntime)
sharedModules.set('react-dom', ReactDOM)
sharedModules.set('react-dom/client', ReactDOMClient)
sharedModules.set('react-router', ReactRouterDOM)
sharedModules.set('react-router-dom', ReactRouterDOM)
;(globalThis as Record<string, unknown>)[CONSOLE_SHARED_MODULES_KEY] = sharedModules

registerBuiltinConsolePages()

function useConsoleRouteElements(): React.ReactElement {
  const v = React.useSyncExternalStore(app.subscribe, app.getVersion, app.getVersion)
  void v
  const routeRecords = app._getRoutes()

  return (
    <>
      {routeRecords.map((r) => (
        <Route key={r.path} path={r.path} element={app._renderRouteElement(r)} />
      ))}
    </>
  )
}

function ConsoleShell() {
  const [ready, setReady] = React.useState(false)
  const registeredRoutes = useConsoleRouteElements()

  useWebSocket()

  React.useEffect(() => {
    void registerOptionalConsoleRoutes()
    loadConsoleEntries()
      .then(() => React.startTransition(() => setReady(true)))
      .catch(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-foreground"></div>
          <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        {registeredRoutes}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

function App() {
  const [authed, setAuthed] = React.useState(hasToken())
  const handleLogin = React.useCallback(() => setAuthed(true), [])
  const initialApiBase = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('apiBaseUrl')
    return raw ? decodeURIComponent(raw) : null
  }, [])

  React.useEffect(() => {
    const onAuthRequired = () => {
      resetConsoleRuntime()
      setAuthed(false)
    }
    window.addEventListener('zhin:auth-required', onAuthRequired)
    return () => window.removeEventListener('zhin:auth-required', onAuthRequired)
  }, [])

  if (!authed) {
    return <LoginPage onSuccess={handleLogin} initialApiBase={initialApiBase} />
  }

  return <ConsoleShell />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </ToastProvider>
  </React.StrictMode>,
)
