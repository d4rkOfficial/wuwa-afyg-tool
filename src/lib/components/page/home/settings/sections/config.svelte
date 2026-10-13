<script lang="ts">
    /**
     * @desc 设置 → 配置导入导出（Phase 5.1 第一增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 内容全部由既有 `settings/config-section.svelte` 承担，本组件只是该 tab 的容器（与外壳无共享状态）。
     *
     * UI 整改：原先本组件还手写了一遍「配置导入导出」标题（`mb-2`、图标继承正文色），
     * 而 `config-section.svelte` 内部又有自己的图标 + 说明行 —— 同一个 tab 有两个标题、两套样式。
     * 现在标题与说明由 `config-section.svelte` 独占（用统一的 `ui/section-title`），本组件只当容器。
     */
    import ConfigSection from '../config-section.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()
</script>

<!-- 一切皆「配置」：独立一级栏目 → 分「设置 / 本地库」两类整体导出 / 导入（JSON） -->
<div class={mergeClass([className])} style={styleProp}>
    <ConfigSection />
</div>
