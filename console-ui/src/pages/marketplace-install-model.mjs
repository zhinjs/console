import { validateManagementState, mutationRequest } from './plugin-management-model.mjs';
export function canResumeInstall(state, packageName, target) {
  return Boolean(target && state && state.packageName === packageName && state.instanceKey === target.instanceKey
    && state.installed && state.plugin && !state.declared && state.version === target.version && state.issues.length === 0);
}
/** Re-read evidence and obtain a new plan; never resubmit the abandoned plan. */
export async function planInstallRecovery(request, packageName, target) {
  const state = validateManagementState(await request({type:'plugin:inspect',instanceKey:target.instanceKey}),target.instanceKey);
  if (!canResumeInstall(state,packageName,target)) throw Error('安装状态已变化，不能沿用补全计划，请重新核对');
  const requestedSpec = `${packageName}@${target.version}`;
  const plan = await request({type:'plugin:plan-install',packageName:requestedSpec});
  if (plan.packageName !== packageName || plan.instanceKey !== target.instanceKey) throw Error('补全计划的包或实例身份已变化');
  mutationRequest('plugin:install',{...plan,requestedSpec});
  return {...plan,requestedSpec,targetVersion:target.version};
}
export async function reconcileInstall(packageName, readState, target) {
  try {
    const state = validateManagementState(await readState(), target.instanceKey);
    if (state.packageName !== packageName) throw Error('Plugin identity mismatch');
    if (state.installed && !state.plugin && !state.declared && state.issues.length === 0 && state.version === target.version) return { state, confirmed: true, message: `已核对：${state.version} 普通依赖已安装，不包含 Plugin 契约，不会挂载到 Runtime；无需重复安装。` };
    if (state.installed && state.declared && state.plugin && state.version === target.version) return { state, confirmed: true, message: `已核对：${state.version} 包可解析且实例声明已保存。应用与业务功能请在插件详情核对；无需重复安装。` };
    return { state, confirmed: false, message: `安装提交结果仍未确认。当前包版本 ${state.version ?? '未知'}，目标 ${target.version}；实例${state.declared ? '已声明' : '未声明'}。旧安装计划已失效，请核对日志，勿重复提交。` };
  } catch {
    return { state: null, confirmed: false, message: '安装提交结果未知，当前无法读取 Host 安装状态。旧安装计划已失效；恢复连接后请重新核对，勿重复提交。' };
  }
}
