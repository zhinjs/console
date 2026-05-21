import * as React from "react";
import { configureConsole } from "@zhin.js/console-core/browser";
import {
  createPluginRegisterHostApi,
  fetchConsoleEntries,
  getRegisterFn,
  loadConsoleEntries as loadEntriesFromSdk,
  registerConsolePluginsFromEntries,
  type CreatePluginRegisterHostApiOptions,
  type FetchConsoleEntriesOptions,
  type LoadConsoleEntriesOptions,
} from "@zhin.js/client";
import { app } from "@zhin.js/client";
import { getApiBase, getToken } from "@console/utils/auth";

export type {
  CreatePluginRegisterHostApiOptions,
  FetchConsoleEntriesOptions,
  LoadConsoleEntriesOptions,
};
export {
  createPluginRegisterHostApi,
  fetchConsoleEntries,
  getRegisterFn,
  registerConsolePluginsFromEntries,
};

const defaultHostRegisterApi = createPluginRegisterHostApi({
  React,
  addRoute: app.addRoute.bind(app),
  addTool: app.addTool.bind(app),
});

function entriesUrlForApiBase(apiBase: string): string {
  const base = apiBase.replace(/\/$/, "");
  return base ? `${base}/entries` : "/entries";
}

export async function loadConsoleEntries(options?: LoadConsoleEntriesOptions): Promise<void> {
  const apiBase = getApiBase();

  await loadEntriesFromSdk({
    ...options,
    entriesUrl: options?.entriesUrl ?? entriesUrlForApiBase(apiBase),
    assetOrigin: options?.assetOrigin ?? apiBase,
    hostApi: options?.hostApi ?? defaultHostRegisterApi,
    beforeLoad: () => {
      configureConsole({
        getRuntimeEnv: () =>
          (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "development"
            ? "development"
            : "production",
      });
      options?.beforeLoad?.();
    },
    fetchInit:
      options?.fetchInit ??
      (() => {
        const token = getToken();
        return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
      }),
    onFetchError: (status) => {
      console.warn(
        `[zhin-console] GET ${entriesUrlForApiBase(apiBase)} failed (HTTP ${status}). ` +
          "确认 Host 已启动、API Base 与 corsOrigins 一致。",
      );
      options?.onFetchError?.(status);
    },
    onEmpty: () => {
      console.warn("[zhin-console] /entries returned empty list.");
      options?.onEmpty?.();
    },
    onEntryError: (entry, error) => {
      console.error(`[zhin-console] Failed to load plugin "${entry.id}":`, error);
      options?.onEntryError?.(entry, error);
    },
  });
}
