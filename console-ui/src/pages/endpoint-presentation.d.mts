export function endpointLifecycleLabel(endpoint: { status: 'online' | 'offline'; pendingLogin?: boolean; transportState?: string }): '等待登录' | '运行中' | '已停止' | '连接中' | '重连中' | '离线'
