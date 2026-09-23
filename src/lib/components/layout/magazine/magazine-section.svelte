<script lang="ts">
    /**
     * @desc 杂志风格分区（弹窗用）：英文 kicker + 衬线粗标题 + 右侧操作 + 细分隔线。
     * 设计定调：弹窗重实用——不放大刊头，以衬线标题与字距营造杂志感；一律直角（去圆角）。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        /** 衬线粗标题（中文主标题） */
        title: string
        /** 英文小标（kicker），如 SETTINGS / BUFF SET */
        kicker?: string
        /** 是否带顶部分隔线（默认 true） */
        divider?: boolean
        /** 标题行右侧操作区 */
        actions?: Snippet
        children?: Snippet
    }

    let { title, kicker, divider = true, actions, children, class: className, style: styleProp }: Props = $props()
</script>

<section
    class={['flex flex-col gap-3', divider ? 'border-t pt-4' : '', className ?? ''].filter(Boolean).join(' ')}
    style={divider ? `border-color: var(--theme-divider-border); ${styleProp ?? ''}` : (styleProp ?? '')}
>
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {#if kicker}
            <span class="text-[10px] font-semibold uppercase tracking-[0.34em] text-(--theme-accent-text) opacity-80"
                >{kicker}</span
            >
        {/if}
        <h3 class="text-base font-black tracking-tight text-(--theme-modal-text)">{title}</h3>
        {#if actions}
            <div class="ml-auto flex items-center gap-2">{@render actions()}</div>
        {/if}
    </div>
    {@render children?.()}
</section>
