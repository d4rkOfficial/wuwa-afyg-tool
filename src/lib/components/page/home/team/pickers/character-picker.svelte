<script lang="ts">
    import type { Character } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { ELEMENT_ORDER } from '$lib/consts/game-terms'
    import EmptyState from '$lib/components/ui/empty-state.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import PickerSearch from './picker-search.svelte'
    import PickerFooter from './picker-footer.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { pickerCardClass } from '$lib/utils/picker-card-class'

    interface GroupData {
        rover: Character[]
        fiveStar: Character[]
        fourStar: Character[]
    }

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
        onselect: (character: Character | null) => void
        characters: Character[]
        icons: Record<string, string>
        elementIcons?: Record<string, string>
        currentName?: string
    }

    let {
        open,
        onclose,
        onselect,
        characters,
        icons,
        elementIcons = {},
        currentName,
        class: className,
        style: styleProp
    }: Props = $props()

    let query = $state('')
    let groupRefs: Record<string, HTMLDivElement | null> = {}
    let localSelected = $state<Character | null>(null)

    $effect(() => {
        if (open) {
            localSelected = characters.find((c) => c.name === currentName) ?? null
            query = ''
        }
    })

    let groupedCharacters = $derived.by(() => {
        const map = new Map<string, GroupData>()
        for (const el of ELEMENT_ORDER) {
            map.set(el, { rover: [], fiveStar: [], fourStar: [] })
        }
        for (const c of characters) {
            const group = map.get(c.element)
            if (!group) continue
            if (c.name.includes('漂泊者')) {
                group.rover.push(c)
            } else if (c.star === 5) {
                group.fiveStar.push(c)
            } else if (c.star === 4) {
                group.fourStar.push(c)
            }
        }
        return map
    })

    let showSearchResults = $derived(query.length > 0)

    let searchResults = $derived(characters.filter((c) => c.name.includes(query)))

    function scrollToElement(element: string) {
        groupRefs[element]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    function toggleSelect(c: Character) {
        if (localSelected?.name === c.name) {
            localSelected = null
        } else {
            localSelected = c
        }
    }

    function handleConfirm() {
        onselect(localSelected)
        onclose()
    }

    function isSelected(c: Character): boolean {
        return localSelected?.name === c.name
    }
</script>

<Modal {open} {onclose} class={mergeClass(['w-170 max-w-[90vw] min-h-[50vh]', className])} style={styleProp}>
    {#snippet title()}
        <PickerSearch bind:value={query} placeholder="搜索角色..." />
    {/snippet}

    <!-- @desc 单列滚动 + 右侧固定锚点列：**只由弹窗外壳滚动**（外壳的 body 已是 `overflow-y-auto`），
         所以这里不再自己开滚动容器、也不锁高度 —— 原先的 `flex h-full min-h-0 overflow-hidden`
         + 左列 `overflow-y-auto` 依赖 `h-full` 能解析到 body 高度，实测解析不出来时整块内容
         由外壳滚动，右侧那列六属性按钮就跟着列表一起滚走了。 -->
    <div class="flex">
        <!-- Content area (left) -->
        <div class="min-w-0 flex-1 p-4">
            {#if showSearchResults}
                {#if searchResults.length === 0}
                    <EmptyState size="lg">无匹配角色</EmptyState>
                {:else}
                    <div class="flex flex-wrap gap-2">
                        {#each searchResults as c (c.name)}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                data-press=""
                                onclick={() => toggleSelect(c)}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        toggleSelect(c)
                                    }
                                }}
                                role="button"
                                tabindex="0"
                                data-sf="widget"
                                data-sf-flat
                                style="--sf-base: var(--theme-input-bg)"
                                class={pickerCardClass(isSelected(c), 'w-[100px]')}
                            >
                                <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                    {#if icons[c.name]}
                                        <img
                                            src={icons[c.name]}
                                            alt={c.name}
                                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                                            class="size-full object-cover"
                                        />
                                    {:else}
                                        <div
                                            class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                        >
                                            {c.name.charAt(0)}
                                        </div>
                                    {/if}
                                </div>
                                <span class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                                    >{c.name}</span
                                >
                            </div>
                        {/each}
                    </div>
                {/if}
            {:else}
                {#each ELEMENT_ORDER as el (el)}
                    {@const group = groupedCharacters.get(el)}
                    {#if group && (group.rover.length > 0 || group.fiveStar.length > 0 || group.fourStar.length > 0)}
                        <div bind:this={groupRefs[el]} class="mb-4">
                            <div
                                class="mb-2 flex items-center gap-1.5 border-t pt-3 text-xs font-black tracking-tight text-(--theme-modal-text)/80"
                                style="border-color: var(--theme-divider-border);"
                            >
                                {#if elementIcons[el]}
                                    <img src={elementIcons[el]} alt={el} class="size-4 object-contain" />
                                {/if}
                                {el}
                            </div>
                            <div class="flex flex-wrap gap-2">
                                {#each ([] as Character[]).concat(group.rover, group.fiveStar, group.fourStar) as c (c.name)}
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        data-press=""
                                        onclick={() => toggleSelect(c)}
                                        onkeydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                toggleSelect(c)
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                        data-sf="widget"
                                        data-sf-flat
                                        style="--sf-base: var(--theme-input-bg)"
                                        class={pickerCardClass(isSelected(c), 'w-[100px]')}
                                    >
                                        <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                            {#if icons[c.name]}
                                                <img
                                                    src={icons[c.name]}
                                                    alt={c.name}
                                                    use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                <div
                                                    class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                                >
                                                    {c.name.charAt(0)}
                                                </div>
                                            {/if}
                                        </div>
                                        <span
                                            class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                                            >{c.name}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>

        <!-- Element nav sidebar (right)：整列铺满分隔线，按钮组 `sticky` 钉在弹窗右侧内顶部，
             列表（外壳 body）怎么滚都不会带走它 -->
        {#if !showSearchResults}
            <div
                class="flex w-10 shrink-0 flex-col items-center border-l"
                style="border-color: var(--theme-divider-border)"
            >
                <div class="sticky top-3 flex flex-col items-center gap-2">
                    {#each ELEMENT_ORDER as el (el)}
                        <button
                            onclick={() => scrollToElement(el)}
                            data-sf="widget"
                            data-sf-flat
                            class="flex size-7 items-center justify-center rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/5 hover:text-(--theme-modal-text)"
                            style="--sf-base: var(--theme-input-bg)"
                            title={el}
                        >
                            {#if elementIcons[el]}
                                <img src={elementIcons[el]} alt={el} class="size-full object-contain" />
                            {:else}
                                <Icon icon="mdi:circle" class="size-3.5" />
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    {#snippet footer()}
        <PickerFooter onconfirm={handleConfirm} />
    {/snippet}
</Modal>
