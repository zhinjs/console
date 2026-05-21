/**
 * Remote Console：WebSocket 连登录时填写的 Host API，不用当前 Pages 域名。
 * 通过 farm alias 替换 @zhin.js/client 内置的 websocket/instance。
 */
import { WebSocketManager } from "@zhin.js/client";
import { resolveWebSocketUrl } from "@console/utils/auth";

let globalWebSocketManager: WebSocketManager | null = null;

export function getWebSocketManager(): WebSocketManager {
  if (!globalWebSocketManager) {
    globalWebSocketManager = new WebSocketManager({
      url: resolveWebSocketUrl("/server"),
    });
    if (typeof window !== "undefined") {
      globalWebSocketManager.connect();
    }
  }
  return globalWebSocketManager;
}

export function destroyWebSocketManager(): void {
  if (globalWebSocketManager) {
    globalWebSocketManager.disconnect();
    globalWebSocketManager = null;
  }
}

export function resetWebSocketManager(): void {
  destroyWebSocketManager();
}
