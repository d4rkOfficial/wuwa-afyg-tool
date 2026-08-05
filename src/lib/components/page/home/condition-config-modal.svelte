<script lang="ts">
    import type { CharSlot } from '$lib/data/types'
    import type { ComponentsProps } from '$lib/types'
    import { getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import {
        getConditionProfile,
        setConditionProfileChains,
        setConditionProfileRefinements
    } from './calculation/calculation.store.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import { fallbackIcon } from '$lib/utils/icons'

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose?: () => void
    }

    let { open, onclose, team, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})

    let loaded = $state(false)
    $effect(() => {
        if (open && !loaded) {
            loaded = true
            getCharacterIcons()
                .then((m) => (charIcons = m))
                .catch(() => {})
            getWeaponIcons()
                .then((m) => (weaponIcons = m))
                .catch(() => {})
        }
    })

    const conditionProfile = $derived(getConditionProfile())
</script>

<Modal {open} {onclose} class={className} style="max-width: min(92vw, 440px); {mergedStyle}">
    {#snippet title()}
        链/阶配置
    {/snippet}
    <div class="space-y-2">
        {#each team as slot, i}
            <div
                class="relative rounded-lg border px-3 py-2 pr-11"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <div class="mb-1.5 flex items-center gap-2">
                    {#if slot.character}
                        {#if charIcons[slot.character]}
                            <img
                                src={charIcons[slot.character]}
                                alt={slot.character}
                                draggable="false"
                                class="size-6 rounded-full object-cover"
                            />
                        {:else}
                            <span
                                class="size-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                                style="background: var(--theme-card-bg); color: var(--theme-modal-text)/50;"
                            >
                                {slot.character.charAt(0)}
                            </span>
                        {/if}
                    {/if}
                    <span class="truncate text-xs font-medium text-(--theme-modal-text)">
                        {slot.character ?? `角色 ${i + 1}`}
                    </span>
                </div>
                {#if slot.weapon}
                    <img
                        src={weaponIcons[slot.weapon]}
                        alt={slot.weapon}
                        draggable="false"
                        use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                        title={slot.weapon}
                        class="absolute right-2 top-1/2 size-9 -translate-y-1/2 object-contain"
                    />
                {/if}
                <div class="flex items-center gap-2">
                    <span class="w-8 shrink-0 text-[10px] text-(--theme-modal-text)/40">角色</span>
                    <div class="flex overflow-hidden rounded border" style="border-color: var(--theme-divider-border);">
                        {#each [0, 1, 2, 3, 4, 5, 6] as n}
                            <button
                                onclick={() => setConditionProfileChains(i, n)}
                                class={[
                                    'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                    (conditionProfile.chains[i] ?? 0) === n
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                ].join(' ')}
                            >
                                {n}
                            </button>
                        {/each}
                    </div>
                    <span class="flex h-6 w-4 items-center text-[11px] font-medium text-(--theme-accent-text)">链</span>
                </div>
                <div class="mt-1.5 flex items-center gap-2">
                    <span class="w-8 shrink-0 text-[10px] text-(--theme-modal-text)/40">武器</span>
                    <div class="flex overflow-hidden rounded border" style="border-color: var(--theme-divider-border);">
                        {#each [1, 2, 3, 4, 5] as n}
                            <button
                                onclick={() => setConditionProfileRefinements(i, n)}
                                class={[
                                    'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                    (conditionProfile.refinements[i] ?? 1) === n
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                ].join(' ')}
                            >
                                {n}
                            </button>
                        {/each}
                    </div>
                    <span class="flex h-6 w-4 items-center text-[11px] font-medium text-(--theme-accent-text)">阶</span>
                </div>
            </div>
        {/each}
        <p class="text-[10px] text-(--theme-modal-text)/40">
            低于生效条件（角色 buff 看共鸣链、武器 buff 看佩戴者武器精炼）的 buff 不生效，实时反映在结果中。
        </p>
    </div>
</Modal>
