<script lang="ts">
    /**
     * @desc 设置 → 配置导入导出（Phase 5.1 第一增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 内容全部由既有 `settings/config-section.svelte` 承担，本组件只是该 tab 的标题 + 容器（与外壳无共享状态）。
     */
    import Icon from '@iconify/svelte'
    import ConfigSection from '../config-section.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()
</script>

<!-- 一切皆「配置」：独立一级栏目 → 分「设置 / 本地库」两类整体导出 / 导入（JSON） -->
<div class={mergeClass([className])} style={styleProp}>
    <span class="mb-2 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)">
        <Icon icon="mdi:cog-sync-outline" class="size-4 shrink-0" />
        配置导入导出
    </span>
    <ConfigSection />
</div>
