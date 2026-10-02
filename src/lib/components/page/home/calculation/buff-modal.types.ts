/**
 * `buff-modal` 组件族的**契约类型**（`buff-modal.svelte` 与同目录拆出的子组件共用）。
 * 与 `buff-modal.utils.ts` 同一放置约定：不 import store，只描述形状。
 *
 * 外壳自身的 props 直接写在其内部的 `interface Props extends ComponentsProps`（闸门 ① 要求），
 * 故此处不再重复一份 `BuffModalProps`。
 */
import type { BuffTreeNode } from '$lib/calc/buff-tree'

/** @desc 左栏列表的三级归类树（由 `buildBuffTree` 派生，随 buffSets / 队伍变化） */
export interface BuffTree {
    nodes: BuffTreeNode[]
    /** @desc 全部目录的折叠 key（拖动时用来「只保留被搬运单元的目录链展开」） */
    folderKeys: string[]
}

/** @desc 供子组件复用的派生查询（父组件注入，保证同一份 `$derived` 不被各子组件重算） */
export interface BuffDerived {
    /** @desc 条目是否属于「全局 Buff」目录（全局 buff 顺序不走非全局重排，因此不参与拖拽） */
    isGlobalBuff: (id: string) => boolean
    /** @desc 队伍槽位的角色图标 */
    teamIconOf: (idx: number) => string | undefined
    /** @desc 队伍槽位当前装配武器的图标（二级「角色名的武器名」目录用） */
    weaponIconOf: (idx: number | undefined) => string | undefined
    /** @desc 角色属性色（store 能力，由父组件注入） */
    elementColor: (name: string) => string
}

/** @desc 列表拖拽落点计算所需的 DOM 查询结果（父组件注入，列表侧只调用） */
export interface BuffListContext {
    /** @desc 列表滚动容器（拖拽的行序列与落点都从它里面读） */
    listContainerOf: (el: EventTarget | null) => HTMLElement | null
    /** @desc 某个父容器的直接行元素 id 序列（DOM 顺序） */
    parentRowIdsOf: (container: HTMLElement, parentKey: string) => string[]
    /** @desc 被拖动元素所在目录链的折叠 key（拖动时必须保持展开） */
    dragKeepExpanded: (el: HTMLElement, container: HTMLElement) => Set<string>
}
