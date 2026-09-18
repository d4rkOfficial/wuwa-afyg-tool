// 「编辑伤害类型」弹窗的开关状态（底部工具栏按钮 / AI、WS 面板工具共用一套入口）

let _open = $state(false)

export function getDamageTypeModalOpen(): boolean {
    return _open
}

export function openDamageTypeModal(): void {
    _open = true
}

export function closeDamageTypeModal(): void {
    _open = false
}

/** @desc 供 AI / WS 面板工具按面板名开关 */
export function setDamageTypeModalOpen(v: boolean): void {
    _open = v
}
