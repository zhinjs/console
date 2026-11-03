/** A disconnected account is not proof that its runtime was deliberately stopped. */
export function endpointLifecycleLabel(endpoint) {
  if (endpoint.pendingLogin) return '等待登录'
  if (endpoint.status === 'online') return '运行中'
  if (endpoint.transportState === 'stopped') return '已停止'
  if (endpoint.transportState === 'connecting') return '连接中'
  if (endpoint.transportState === 'reconnecting') return '重连中'
  return '离线'
}
