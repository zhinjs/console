/**
 * Section anchors of 运维 → 实例, the single detail page of the running state. Other pages (机器人状态,
 * 首页「进程与资源」) link to a section with {@link instanceSectionHref}.
 */
export const INSTANCE_SECTION_IDS = Object.freeze({ status: 'instance-status', logs: 'instance-logs', dependencies: 'instance-dependencies' })

/** `/ops/instance#instance-status` etc.; unknown sections link to the page top. */
export function instanceSectionHref(section = 'status', base = '/ops/instance') {
  const id = INSTANCE_SECTION_IDS[section]
  return id ? `${base}#${id}` : base
}
