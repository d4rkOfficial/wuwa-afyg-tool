/**
 * @desc 「以下修改还未保存」确认弹窗的数据结构（列表 + 卡片两处共用）。
 *
 * 放在 `$lib/types` 而不是某个组件里：`ui/unsaved-changes-dialog.svelte` 与页面级 diff 工具
 * （`buff-modal` / `damage-type-modal`）都要用它，ui 层不该反向依赖页面级文件。
 */

/** @desc 变更卡片色调：新增 / 修改 / 删除 */
export type UnsavedChangeTone = 'create' | 'update' | 'remove'

/** @desc 一张变更卡片：标题 + 副标题 + 逐行明细 */
export interface UnsavedChangeItem {
    /** @desc 稳定 key（`{#each}` 用；同一对象只出一条） */
    key: string
    /** @desc 变更对象（Buff 短名 / 倍率名 / 文件夹名） */
    title: string
    /** @desc 种类标注（新建 BUFF / 修改 BUFF / 删除 / 伤害类型 …） */
    subtitle?: string
    tone: UnsavedChangeTone
    /** @desc 逐行明细（名称、作用范围、乘区、位置 …） */
    lines: string[]
}
