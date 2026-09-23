<script lang="ts">
    /**
     * @desc 杂志风格分区（弹窗用）：图标 + 衬线粗标题 + 右侧操作 + 细分隔线。
     * 设计定调：弹窗重实用——不放大刊头、不用英文小标，以图标 + 衬线标题 + 字距营造杂志感；一律直角。
     */
    import Icon from '@iconify/svelte'
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        /** 衬线粗标题（中文主标题） */
        title: string
        /** 标题左侧图标（替代英文小标） */
        icon?: string
        /** 是否带顶部分隔线（默认 true） */
        divider?: boolean
        /** 标题行右侧操作区 */
        actions?: Snippet
        children?: Snippet
    }

    let { title, icon, divider = true, actions, children, class: className, style: styleProp }: Props = $props()
</script>

<section
    class={['flex flex-col gap-3', divider ? 'border-t pt-4' : '', className ?? ''].filter(Boolean).join(' ')}
    style={divider ? `border-color: var(--theme-divider-border); ${styleProp ?? ''}` : (styleProp ?? '')}
>
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {#if icon}
            <Icon {icon} class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        {/if}
        <h3 class="text-base font-black tracking-tight text-(--theme-modal-text)">{title}</h3>
        {#if actions}
            <div class="ml-auto flex items-center gap-2">{@render actions()}</div>
        {/if}
    </div>
    {@render children?.()}
</section>
