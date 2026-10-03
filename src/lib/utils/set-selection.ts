/**
 * @desc 触发套装选择的**纯逻辑**（唯一口径）：部位预算、件数切换、有效件数、展示文案。
 *
 * 为什么抽出来：同一套「同名取最大件数再求和」的口径原先在 `set-picker.svelte`、
 * `team-config.svelte`、`ai/tools/team.ts` 里各写了一遍；而件数切换的预算判断只写在 picker 里，
 * 于是**选完 3 件套再点 5 件套**会绕过预算（`{A,3}` + `{B,5}` + `{B,2}` = 8/5，见 `togglePieceSelection` 注释）。
 * 这里把口径收成一处，UI 与 AI 工具共用，测试也直接打在这层。
 */
import type { SelectedSet } from '$lib/types/project'

/** @desc 触发套装的部位预算：5 个声骸位（picker 底部 `N/5` 与 AI 工具校验同一口径） */
export const MAX_SET_PIECES = 5

/** @desc 有效件数：**同名只取最大件数**后求和（`{A,5}` + `{A,2}` 只算 5，2 件套效果被 5 件套包含） */
export const totalPiecesOf = (sets: readonly SelectedSet[]): number => {
    const byName = new Map<string, number>()
    for (const s of sets) {
        const cur = byName.get(s.name) ?? 0
        if (s.pieces > cur) byName.set(s.name, s.pieces)
    }
    return [...byName.values()].reduce((a, b) => a + b, 0)
}

/** @desc 剩余可用部位 */
export const remainingPiecesOf = (sets: readonly SelectedSet[]): number =>
    Math.max(0, MAX_SET_PIECES - totalPiecesOf(sets))

/**
 * @desc 5 件套的选择结果：**只留这一套**，并附上被它包含的 2 件套条目。
 *
 * 5 件套占满全部 5 个部位，因此它与任何其它套装都不可共存 —— 选中它必须**替换掉**先前选择。
 * 曾经的 bug：新选 5 件套时只做 `[...selected, {5}, {2}]`，于是「先 3 件套、再 5 件套」
 * 会得到 3 + 5 = 8 件（超出预算），且 picker 底部仍显示 `8/5`。
 */
export const fivePieceSelection = (name: string): SelectedSet[] => [
    { name, pieces: 5 },
    { name, pieces: 2 }
]

/**
 * @desc 该件数档位当前是否可点：
 * - 该套装已被选中 → 恒可点（换档 / 取消由 `togglePieceSelection` 处理）
 * - 5 件套 → 恒可点（它会替换掉其它套装，不占「剩余部位」）
 * - 其余档位 → 需 `件数 <= 剩余部位`
 */
export const canPickPiece = (sets: readonly SelectedSet[], name: string, pieces: number): boolean => {
    if (sets.some((s) => s.name === name)) return true
    if (pieces >= MAX_SET_PIECES) return true
    return pieces <= remainingPiecesOf(sets)
}

/**
 * @desc 切换某套装的件数档位，返回新的选择：
 * - 点已选中的同一档 → 取消该套装
 * - 点该套装的另一档 → 换成那一档（5 件套仍按 `fivePieceSelection` 处理）
 * - 新选 5 件套 → 替换掉全部其它套装（预算所限，见 `fivePieceSelection`）
 * - 新选其它档 → 追加（调用方已用 `canPickPiece` 挡住超预算的点击）
 */
export const togglePieceSelection = (sets: readonly SelectedSet[], name: string, pieces: number): SelectedSet[] => {
    const existing = sets.find((s) => s.name === name)
    if (existing?.pieces === pieces) return sets.filter((s) => s.name !== name)
    if (pieces >= MAX_SET_PIECES) return fivePieceSelection(name)
    return [...sets.filter((s) => s.name !== name), { name, pieces }]
}

/** @desc 展示文案：`A(5) + B(2)`（同名取最大件数；空选择为「无」） */
export const formatSetSelection = (sets: readonly SelectedSet[]): string => {
    if (sets.length === 0) return '无'
    const byName = new Map<string, number>()
    for (const s of sets) {
        const cur = byName.get(s.name) ?? 0
        if (s.pieces > cur) byName.set(s.name, s.pieces)
    }
    return [...byName.entries()].map(([name, pieces]) => `${name}(${pieces})`).join(' + ')
}
