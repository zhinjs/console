export function databaseSaveError(error) {
 const details = error instanceof Error ? error.message : String(error)
 const duplicate = /unique constraint|duplicate key|duplicate entry/i.test(details)
 return {type:'error', text:duplicate ? '主键或唯一字段已存在，请修改后重试。' : '保存失败，当前输入已保留。请检查详情后重试。', details}
}
