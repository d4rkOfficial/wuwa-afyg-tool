<script lang="ts">
    /**
     * @desc 时间轴「伤害绑定」轨道的伤害块叠层（第 4 轨 overlay）。
     *
     * 抽自 `timeline.svelte` 的单块渲染块（约 96 行）：它是该文件里**唯一**自成一段、
     * 与操作块/参考线互不干扰的大结构（AGENTS §3「大的布局结构 → 独立组件」）。
     *
     * 职责边界：
     * - **不拥有**状态：叠层数据 `damageStack`、查找索引 `teamByChar` / `opBlockById`、
     *   以及 `gpuAccel` 全由宿主传入（宿主已经为伤害层渲染建好了这几个索引，重复建会白花开销）。
     * - **自带**两个动作：`nonpassiveWheel`（Ctrl+滚轮纵向滚动，必须 `passive:false` 才能
     *   `preventDefault`）与 `measureDamageWidth`（把块宽批量提交给 store）。
     *   `measureDamageWidth` 原本与宿主的 `measureWidth` 共享「一个微任务只 flush 一次」的
     *   批处理标记；两者**读写的是不同 store 字段**（伤害块宽 vs 操作块宽），拆开后各自批处理，
     *   语义不变（同一帧内至多多一次微任务写入）。
     * - 仍直接调用 store 读取拖拽/选中状态（`getIsGroupDrag` / `getDragBlockId` 等）：
     *   与 `damage-list` / `skill-picker` 等同目录组件一致 —— 这些是全局单例状态，不是宿主私有状态。
     */
    import type { CharSlot } from '$lib/types/project'
    import type { OpBlock, DamageBlock } from '$lib/calc/timeline.types'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'
    import {
        getSelectedBlockIds,
        getSelectedRefLineIds,
        getIsGroupDrag,
        getDragBlockId,
        getDraggingId,
        setDamageWidths,
        getTRACKS,
        estimateDamageHeight
    } from '$lib/calc/timeline.store.svelte'
    import { NON_DIRECT_ELEMENT } from '$lib/calc/timeline.consts'
    import { damageStackStyle, nonDirectSortWeight } from './timeline-styles.utils'

    interface Props extends ComponentsProps {
        /** @desc 叠层条目（含已按轨道算好的 top/left） */
        damageStack: { block: DamageBlock; top: number; left: number }[]
        team: [CharSlot, CharSlot, CharSlot]
        teamByChar: Map<string, CharSlot>
        opBlockById: Map<string, OpBlock>
        gpuAccel: boolean
    }

    let { damageStack, team, teamByChar, opBlockById, gpuAccel, class: className, style: styleProp }: Props = $props()

    // ── Ctrl+滚轮纵向滚动：必须非 passive 才能 preventDefault ──
    const nonpassiveWheel = (node: HTMLElement, handler: (e: WheelEvent) => void) => {
        node.addEventListener('wheel', handler, { passive: false })
        return {
            destroy() {
                node.removeEventListener('wheel', handler)
            }
        }
    }

    const onDamageWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault()
            e.stopPropagation()
            const el = e.currentTarget as HTMLElement
            el.scrollTop += e.deltaY
        }
    }

    // ── 块宽测量批量提交：首帧 N 个块各自写宽度会触发 N 次整表重排（damageStack 派生值随每次写重算）；
    //    先入 pending，微任务里统一写一次 store ──
    const pendingDamageWidths = new Map<string, number>()
    let widthFlushScheduled = false

    const scheduleWidthFlush = () => {
        if (widthFlushScheduled) return
        widthFlushScheduled = true
        queueMicrotask(() => {
            widthFlushScheduled = false
            if (pendingDamageWidths.size === 0) return
            setDamageWidths(Object.fromEntries(pendingDamageWidths))
            pendingDamageWidths.clear()
        })
    }

    const measureDamageWidth = (node: HTMLElement, blockId: string) => {
        const set = () => {
            pendingDamageWidths.set(blockId, node.offsetWidth)
            scheduleWidthFlush()
        }
        set()
        const ro = new ResizeObserver(set)
        return { destroy: () => ro.disconnect() }
    }

    /** @desc 叠层容器高度：所有块底边最大者 + 12px 余量 */
    let stackHeight = $derived.by(() => {
        let maxBottom = 0
        for (const item of damageStack) {
            maxBottom = Math.max(maxBottom, item.top + estimateDamageHeight(item.block))
        }
        return maxBottom + 12
    })
</script>

<div
    class={mergeClass(['absolute pointer-events-auto theme-scrollbar overflow-y-auto', className || ''])}
    style="left: 5rem; top: 0; right: 0; bottom: 0; z-index: 6;{styleProp ? ` ${styleProp}` : ''}"
    use:nonpassiveWheel={onDamageWheel}
>
    <div class="relative" style="height: {stackHeight}px; width: 100%;">
        {#each damageStack as { block: dmg, top, left } (dmg.id)}
            {@const isGroupDrag = getIsGroupDrag()}
            {@const isParentDragged = isGroupDrag
                ? dmg.sourceType === 'op'
                    ? getSelectedBlockIds()[dmg.sourceId]
                    : getSelectedRefLineIds()[dmg.sourceId]
                : getDragBlockId() !== null &&
                  dmg.sourceType === 'op' &&
                  (Object.keys(getSelectedBlockIds()).length > 1
                      ? getSelectedBlockIds()[dmg.sourceId]
                      : getDragBlockId() === dmg.sourceId)}
            {@const isDimmed = (getDragBlockId() !== null || isGroupDrag) && !isParentDragged}
            <div
                class="absolute cursor-default"
                style={damageStackStyle(
                    left,
                    top,
                    isParentDragged ? 1.2 : 1,
                    isDimmed,
                    getDragBlockId() !== null || getDraggingId() !== null,
                    gpuAccel
                )}
            >
                <div class="flex flex-col items-start gap-0.5 px-1 py-0.5" use:measureDamageWidth={dmg.id}>
                    {#each dmg.skillHits as hit, hi (hi)}
                        {@const echoName = teamByChar.get(hit.character)?.echoes?.[0]?.name}
                        {@const srcOp = dmg.sourceType === 'op' ? opBlockById.get(dmg.sourceId) : null}
                        {@const srcChar =
                            dmg.sourceType === 'ref'
                                ? ''
                                : srcOp && srcOp.trackIndex < getTRACKS().length - 1
                                  ? (team[srcOp.trackIndex]?.character ?? '')
                                  : ''}
                        <span
                            class="text-[11px] font-bold leading-tight border border-dashed rounded-none px-1.5 py-px"
                            style="color: var(--theme-element-{hit.element}, #888); border-color: var(--theme-element-{hit.element}, #888);"
                        >
                            {(dmg.sourceType === 'ref' && hit.character
                                ? `[${hit.character}]`
                                : dmg.sourceType === 'op' && hit.character && hit.character !== srcChar
                                  ? `[${hit.character}]`
                                  : '') +
                                (hit.skillType === '声骸技能' && echoName ? echoName + '·' : '') +
                                hit.hitName.replace('伤害', '') +
                                ((hit.hits ?? 0) > 1 ? '\u00D7' + hit.hits : '')}
                        </span>
                    {/each}
                    {#each [...dmg.nonDirectEntries].sort((a, b) => nonDirectSortWeight(a.category) - nonDirectSortWeight(b.category)) as nd, ni (ni)}
                        {@const c =
                            nd.category === '响应'
                                ? 'var(--theme-accent-bg)'
                                : nd.category === '处决'
                                  ? 'var(--theme-accent-text)'
                                  : (NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]
                                    ? `var(--theme-element-${(NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]}, #888)`
                                    : 'var(--theme-accent-bg)'}
                        <span
                            class="text-[11px] font-bold leading-tight border border-dashed rounded-none px-1.5 py-px"
                            style="color: {c}; border-color: {c}; opacity: {nd.category === '效应' ? 0.75 : 1};"
                        >
                            {nd.category === '效应'
                                ? nd.name + nd.layers + '层' + ((nd.hits ?? 1) > 1 ? `×${nd.hits}段` : '')
                                : nd.name}{nd.responders?.length ? '[' + nd.responders.join(',') + ']' : ''}
                        </span>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>
