<script lang="ts">
    /** @desc 紧凑自定义下拉（非原生 select）：触发按钮 + relative 容器内 absolute 弹层，供对比配置的链/阶选择 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Option {
        value: string
        label: string
    }

    interface Props extends ComponentsProps {
        options: Option[]
        value: string
        onchange?: (v: string) => void
        disabled?: boolean
    }

    let { options, value, onchange, disabled = false, class: className, style: styleProp }: Props = $props()
    let open = $state(false)

    let current = $derived(options.find((o) => o.value === value))

    function toggle() {
        if (disabled) return
        open = !open
    }
    function select(v: string) {
        onchange?.(v)
        open = false
    }
</script>

<div class="relative {className ?? ''}" style={styleProp}>
    <button
        onclick={toggle}
        {disabled}
        type="button"
        class="flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs outline-none transition-colors focus:border-(--theme-accent-bg) {disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-(--theme-accent-bg)'}"
        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); background: transparent;"
    >
        <span class="tabular-nums">{current?.label ?? value}</span>
        <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3 shrink-0 opacity-40" />
    </button>

    {#if open}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- 透明遮罩：点击任意处关闭（z 低于菜单，高于周围内容） -->
        <div class="fixed inset-0 z-40" role="presentation" onclick={() => (open = false)}></div>
        <div
            class="animate-pop-in absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-14 overflow-y-auto rounded-lg border py-1 shadow-xl backdrop-blur-lg"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent); border-color: var(--theme-divider-border);"
        >
            {#each options as opt}
                <button
                    onclick={() => select(opt.value)}
                    type="button"
                    class="flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs transition-colors {opt.value ===
                    value
                        ? 'text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'}"
                >
                    <span class="tabular-nums">{opt.label}</span>
                    {#if opt.value === value}<Icon
                            icon="mdi:check"
                            class="size-3 shrink-0 text-(--theme-accent-text)"
                        />{/if}
                </button>
            {/each}
        </div>
    {/if}
</div>
