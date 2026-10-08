export async function reconcileInstall(packageName, readPlan) {
  try {
    const plan = await readPlan();
    if (plan.packageName !== packageName || typeof plan.alreadyInstalled !== 'boolean' || typeof plan.alreadyDeclared !== 'boolean') throw new Error('invalid plan');
    if (plan.alreadyInstalled && plan.alreadyDeclared) return { confirmed: true, message: '已核对：依赖声明与插件挂载已持久保存。安装回执丢失，运行是否生效请在重启后核对；无需重复安装。' };
    return { confirmed: false, message: `安装提交结果仍未确认。最新状态：依赖声明${plan.alreadyInstalled ? '已保存' : '未发现'}，插件挂载${plan.alreadyDeclared ? '已保存' : '未发现'}。旧安装计划已失效，请核对 Host 日志并重新检查状态，勿重复提交。` };
  } catch {
    return { confirmed: false, message: '安装提交结果未知，当前无法读取 Host 安装状态。旧安装计划已失效；恢复连接后请重新核对，勿重复提交。' };
  }
}
