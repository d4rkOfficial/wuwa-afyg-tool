<script lang="ts">
    /**
     * @desc 乘区级生效条件（行内下拉展开）：拉表页 BUFF 配置弹窗的薄封装。
     * 实际面板与工坊预设编辑器共用 `$lib/components/layout/zone-condition-panel.svelte`，保证两处口径一致。
     */
    import type { ComponentsProps } from '$lib/types'
    import type { BuffCondition } from '$lib/calc/calculation.types'
    import ZoneConditionPanel from '$lib/components/layout/zone-condition-panel.svelte'

    interface Props extends ComponentsProps {
        condition: BuffCondition | undefined
        onchange: (condition: BuffCondition | null) => void
    }
    let { condition, onchange, class: className, style: styleProp }: Props = $props()
</script>

<ZoneConditionPanel {condition} {onchange} class={className} style={styleProp} />
