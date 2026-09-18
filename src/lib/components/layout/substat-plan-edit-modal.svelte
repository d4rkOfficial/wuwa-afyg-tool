<script lang="ts">
    /**
     * @desc 方案编辑弹窗（词条集里「修改 / 新建方案」打开）：独立的弹窗，内含与工程-词条配置一致的五个声骸卡片。
     * 与词条集列表弹窗同级挂载（DOM 中在列表弹窗之后），因此叠在列表之上。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import SubstatPlanEditor from '$lib/components/layout/substat-plan-editor.svelte'
    import { STANDARD_PLAN_NAME } from '$lib/calc/standard-substats'
    import type { EchoSlotConfig } from '$lib/calc/config.types'

    interface Props extends ComponentsProps {
        open: boolean
        character: string
        /** @desc 方案名（标准14词条显示固定名） */
        name: string
        standard?: boolean
        slots: EchoSlotConfig[]
        saving?: boolean
        onsave: (slots: EchoSlotConfig[]) => void
        oncancel: () => void
    }

    let {
        open,
        character,
        name,
        standard = false,
        slots,
        saving = false,
        onsave,
        oncancel,
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<Modal {open} onclose={oncancel} backdropClose class="w-[88rem] max-w-[97vw] {className}" style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:clipboard-text-outline" class="size-4" />
            <span>{standard ? `修改「${character}」的 ${STANDARD_PLAN_NAME}` : `编辑方案：${name}`}</span>
            {#if standard}
                <span class="text-[10px] font-normal text-(--theme-muted-text)">保存时副词条需恰好 14 条</span>
            {/if}
        </span>
    {/snippet}

    {#if open}
        {#key `${character}|${name}|${standard}`}
            <SubstatPlanEditor initialSlots={slots} {standard} {saving} {onsave} {oncancel} />
        {/key}
    {/if}
</Modal>
