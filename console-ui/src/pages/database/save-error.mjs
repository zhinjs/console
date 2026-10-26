import { translate } from '../../i18n/locale.mjs'
export function databaseSaveError(error, locale = 'zh-CN') {
 const details = error instanceof Error ? error.message : String(error)
 const duplicate = /unique constraint|duplicate key|duplicate entry/i.test(details)
 return {type:'error', text:duplicate ? translate(locale, "主键或唯一字段已存在，请修改后重试。") : translate(locale, "保存失败，当前输入已保留。请检查详情后重试。"), details}
}
