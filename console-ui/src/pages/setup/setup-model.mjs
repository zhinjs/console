// Pure helpers of the first-run setup wizard (ADR 0049 §7, ADR 0053 §2 steps 1–2).

/** Whether the wizard resumes at the owner step: the database step was saved in an earlier visit. */
export function resumeAtOwner(onboarding) {
  const status = onboarding && typeof onboarding === 'object' ? onboarding.steps?.database : undefined
  return status === 'done' || status === 'skipped'
}

/** Title of a blocked wizard, by the failure code. */
export function setupBlockedTitle(failure, t) {
  switch (failure?.code) {
    case 'conflict': return t('已完成初始化')
    case 'forbidden': return t('需要初始化令牌')
    case 'unreachable': return t('连不上 Host')
    case 'database_busy': return t('数据库忙')
    case 'unavailable': return t('数据库未就绪')
    default: return t('无法读取初始化状态')
  }
}

/** The exact next step for a blocked wizard (appended to the failure message). */
export function setupNextStep(failure, t) {
  switch (failure?.code) {
    case 'conflict': return t('用所有者账号登录；忘记密码时在服务器上运行 zhin console user passwd <用户名>。')
    case 'forbidden': return t('重新连接，并使用启动日志里的初始化链接（#token=…）。')
    case 'unreachable': return t('确认 zhin start 正在运行、地址正确，然后重试。')
    case 'database_busy': return t('稍等片刻后重试。')
    case 'unavailable': return t('检查 zhin.config.yml 的 database 配置，或在服务器上运行 zhin console init --status 查看原因。')
    default: return t('重试；仍然失败时查看网关日志（zhin logs）。')
  }
}
