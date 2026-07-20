<script lang="ts">
    import { getCharacterInfo, getWeaponInfo, getEchoInfo, getEchoSetInfo } from '$lib/data/api'
    import {
        getCharacterIcons,
        getWeaponIcons,
        getEchoIcons,
        getEchoSetIcons,
        getElementIcons,
        getWeaponTypeIcons
    } from '$lib/data/api'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import type { CharSlot } from '$lib/data/types'
    import Icon from '@iconify/svelte'

    interface Props {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onCreateBuff: (name: string) => void
        onCreateCustomHit?: (name: string) => void
        showBuffOption?: boolean
        showCustomHitOption?: boolean
        onclose: () => void
    }

    let {
        open,
        team,
        onCreateBuff,
        onCreateCustomHit,
        showBuffOption = true,
        showCustomHitOption = true,
        onclose
    }: Props = $props()

    let charIndex = $state(0)
    let activeAccordion = $state<string | null>(null)
    let openSkillName = $state<string | null>(null)
    let charData = $state<CharacterInfo | null>(null)
    let weaponData = $state<WeaponInfo | null>(null)
    let echoSkillData = $state<{ desc: string; values: [string, string, string][] } | null>(null)
    let setBonuses = $state<Record<string, string> | null>(null)
    let loading = $state(false)
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let echoIcons = $state<Record<string, string>>({})
    let setIcons = $state<Record<string, string>>({})
    let elementIcons = $state<Record<string, string>>({})
    let weaponTypeIcons = $state<Record<string, string>>({})
    let ctxShow = $state(false)
    let ctxX = $state(0)
    let ctxY = $state(0)

    let charNames = $derived(team.map((s) => s.character).filter((c): c is string => c !== null))
    let currentSlot = $derived(team[charIndex])

    $effect(() => {
        if (open) loadIcons()
    })

    $effect(() => {
        if (open && currentSlot.character) fetchData(currentSlot)
    })

    async function loadIcons() {
        const [ci, wi, ei, si, eli, wti] = await Promise.all([
            getCharacterIcons(),
            getWeaponIcons(),
            getEchoIcons(),
            getEchoSetIcons(),
            getElementIcons(),
            getWeaponTypeIcons()
        ])
        charIcons = ci
        weaponIcons = wi
        echoIcons = ei
        setIcons = si
        elementIcons = eli
        weaponTypeIcons = wti
    }

    async function fetchData(slot: CharSlot) {
        if (!slot.character) return
        loading = true
        charData = null
        weaponData = null
        echoSkillData = null
        setBonuses = null
        activeAccordion = null
        openSkillName = null
        try {
            const ci = await getCharacterInfo(slot.character)
            charData = ci
            if (slot.weapon)
                getWeaponInfo(slot.weapon)
                    .then((w) => (weaponData = w))
                    .catch(() => {})
            const echoName = slot.echoes[0]?.name
            if (echoName)
                getEchoInfo(echoName)
                    .then((e) => (echoSkillData = e.skill))
                    .catch(() => {})
            if (slot.triggerSets.length > 0)
                getEchoSetInfo(slot.triggerSets[0].name)
                    .then((s) => (setBonuses = s.bonuses))
                    .catch(() => {})
        } catch {
            /* ignore */
        }
        loading = false
    }

    function handleAccordion(name: string) {
        activeAccordion = activeAccordion === name ? null : name
        openSkillName = null
    }

    function handleSkillToggle(name: string) {
        openSkillName = openSkillName === name ? null : name
    }

    function handleCtxMenu(e: MouseEvent) {
        e.preventDefault()
        ctxX = e.clientX
        ctxY = e.clientY
        ctxShow = true
    }

    function handleCopy() {
        const s = window.getSelection()?.toString()
        if (s) navigator.clipboard.writeText(s).catch(() => {})
        ctxShow = false
    }

    function handleCreateBuffFromSel() {
        const s = window.getSelection()?.toString()
        if (s) {
            onCreateBuff(s.trim())
            onclose()
        }
        ctxShow = false
    }

    function handleCreateCustomHit() {
        const s = window.getSelection()?.toString()
        if (s && onCreateCustomHit) {
            onCreateCustomHit(s.trim())
            onclose()
        }
        ctxShow = false
    }

    const img = (p: string) => p || ''
    const rd = (s: string) => s.replace(/\n/g, '<br>')
</script>

{#if open}
    <div
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-lg select-text"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
        oncontextmenu={handleCtxMenu}
    >
        <div
            class="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-2xl"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <h2 class="text-sm font-semibold">速查</h2>
                <button
                    onclick={onclose}
                    class="flex size-7 items-center justify-center rounded-md text-[var(--theme-modal-text)]/50 hover:bg-white/10 hover:text-[var(--theme-modal-text)]"
                    ><Icon icon="mdi:close" class="size-4" /></button
                >
            </div>
            <div class="flex gap-1 border-b border-white/10 px-5 py-2">
                {#each charNames as name, i}
                    <button
                        onclick={() => {
                            charIndex = i
                        }}
                        class={[
                            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                            i === charIndex
                                ? 'bg-indigo-500/15 text-indigo-300'
                                : 'text-[var(--theme-modal-text)]/50 hover:bg-white/5'
                        ].join(' ')}
                    >
                        {#if img(charIcons[name])}<img
                                src={img(charIcons[name])}
                                alt={name}
                                class="inline size-4 mr-1 rounded-full object-cover"
                            />{/if}{name}
                    </button>
                {/each}
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4">
                {#if loading}
                    <div class="flex items-center justify-center py-16 text-xs text-[var(--theme-modal-text)]/50">
                        加载中...
                    </div>
                {:else if charData}
                    <div class="space-y-5">
                        <div class="flex items-center gap-3">
                            {#if img(charIcons[currentSlot.character ?? ''])}<img
                                    src={img(charIcons[currentSlot.character ?? ''])}
                                    alt=""
                                    class="size-10 rounded-md object-contain bg-white/5"
                                />{/if}
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-semibold">{currentSlot.character}</span>
                                <span class="text-xs text-yellow-400">{'★'.repeat(charData.rarity)}</span>
                                {#if img(elementIcons[charData.element])}<img
                                        src={img(elementIcons[charData.element])}
                                        alt={charData.element}
                                        class="size-4"
                                        title={charData.element}
                                    />{:else}<span class="rounded bg-white/5 px-1.5 py-0.5 text-[10px]"
                                        >{charData.element}</span
                                    >{/if}
                                {#if img(weaponTypeIcons[charData.weaponType])}<img
                                        src={img(weaponTypeIcons[charData.weaponType])}
                                        alt={charData.weaponType}
                                        class="size-4"
                                        title={charData.weaponType}
                                    />{:else}<span class="rounded bg-white/5 px-1.5 py-0.5 text-[10px]"
                                        >{charData.weaponType}</span
                                    >{/if}
                            </div>
                        </div>
                        <section>
                            <h3 class="mb-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/50">
                                基础属性 (Lv90)
                            </h3>
                            <div class="grid grid-cols-4 gap-2">
                                <div class="rounded-lg bg-white/5 p-2.5 text-center">
                                    <div class="text-[10px] text-[var(--theme-modal-text)]/50">HP</div>
                                    <div class="mt-0.5 text-xs font-semibold tabular-nums">
                                        {charData.lv90BaseStats.hp}
                                    </div>
                                </div>
                                <div class="rounded-lg bg-white/5 p-2.5 text-center">
                                    <div class="text-[10px] text-[var(--theme-modal-text)]/50">ATK</div>
                                    <div class="mt-0.5 text-xs font-semibold tabular-nums">
                                        {charData.lv90BaseStats.atk}
                                    </div>
                                </div>
                                <div class="rounded-lg bg-white/5 p-2.5 text-center">
                                    <div class="text-[10px] text-[var(--theme-modal-text)]/50">DEF</div>
                                    <div class="mt-0.5 text-xs font-semibold tabular-nums">
                                        {charData.lv90BaseStats.def}
                                    </div>
                                </div>
                                <div class="rounded-lg bg-white/5 p-2.5 text-center">
                                    <div class="text-[10px] text-[var(--theme-modal-text)]/50">谐度</div>
                                    <div class="mt-0.5 text-xs font-semibold tabular-nums">
                                        {charData.lv90BaseStats.tune}
                                    </div>
                                </div>
                            </div>
                        </section>
                        {#if currentSlot.weapon}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/50">
                                    武器
                                </h3>
                                <div class="rounded-lg bg-white/5 p-3 space-y-2">
                                    <div class="flex items-center gap-2">
                                        {#if img(weaponIcons[currentSlot.weapon])}<img
                                                src={img(weaponIcons[currentSlot.weapon])}
                                                alt=""
                                                class="size-8 rounded object-contain bg-white/5"
                                            />{/if}
                                        <div>
                                            <div class="flex items-center gap-1.5 text-xs font-medium">
                                                <span>{currentSlot.weapon}</span>{#if weaponData}<span
                                                        class="text-yellow-400 text-[10px]"
                                                        >{'★'.repeat(weaponData.rarity)}</span
                                                    >{/if}
                                            </div>
                                            {#if weaponData}<div
                                                    class="text-[10px] text-[var(--theme-modal-text)]/50 mt-0.5"
                                                >
                                                    基础攻击 {weaponData.lv90BaseAtk}
                                                </div>{/if}
                                        </div>
                                    </div>
                                    {#if weaponData}<div
                                            class="text-[10px] text-[var(--theme-modal-text)]/70 border-t border-white/10 pt-2"
                                        >
                                            <span class="text-cyan-400">{weaponData.substat.name}</span>
                                            {weaponData.substat.value}
                                        </div>
                                        <div class="mt-1 text-[10px] text-[var(--theme-modal-text)]/60 leading-relaxed">
                                            {@html rd(weaponData.effect.desc)}
                                        </div>{/if}
                                </div>
                            </section>
                        {/if}
                        {#if currentSlot.echoes[0]?.name}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/50">
                                    首位声骸
                                </h3>
                                <div class="rounded-lg bg-white/5 p-3">
                                    <div class="flex items-center gap-2">
                                        {#if img(echoIcons[currentSlot.echoes[0].name])}<img
                                                src={img(echoIcons[currentSlot.echoes[0].name])}
                                                alt=""
                                                class="size-8 rounded object-contain bg-white/5"
                                            />{/if}
                                        <div class="text-xs font-medium">
                                            {currentSlot.echoes[0].name}<span
                                                class="text-[var(--theme-modal-text)]/50 ml-1"
                                                >(C{currentSlot.echoes[0].cost})</span
                                            >{#if currentSlot.triggerSets.length > 0}<span
                                                    class="text-[10px] text-indigo-400 ml-1.5"
                                                    >[{currentSlot.triggerSets[0].name}]</span
                                                >{/if}
                                        </div>
                                    </div>
                                    {#if echoSkillData}<div
                                            class="mt-2 text-[10px] text-[var(--theme-modal-text)]/60 leading-relaxed border-t border-white/10 pt-2"
                                        >
                                            {@html rd(echoSkillData.desc)}
                                        </div>{/if}
                                </div>
                            </section>
                        {/if}
                        {#if setBonuses}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/50">
                                    套装加成
                                </h3>
                                <div class="rounded-lg bg-white/5 p-3 space-y-1">
                                    {#each Object.entries(setBonuses) as [pieces, desc]}<div class="text-xs">
                                            <span class="text-indigo-400 font-medium">{pieces}件套</span><span
                                                class="text-[var(--theme-modal-text)]/70 ml-1">{desc}</span
                                            >
                                        </div>{/each}
                                </div>
                            </section>
                        {/if}
                        <section>
                            <button
                                onclick={() => handleAccordion('skills')}
                                class="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/70 transition-colors hover:bg-white/10"
                            >
                                <Icon
                                    icon={activeAccordion === 'skills' ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                    class="size-3.5"
                                />
                                技能
                            </button>
                            {#if activeAccordion === 'skills'}
                                <div class="mt-2 space-y-1">
                                    {#each charData.skills as skill}
                                        <div class="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                                            <button
                                                onclick={() => handleSkillToggle(skill.name)}
                                                class="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--theme-modal-text)] transition-colors hover:bg-white/5"
                                            >
                                                <span
                                                    class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--theme-modal-text)]/50"
                                                    >{skill.type}</span
                                                >
                                                <span class="flex-1 text-left">{skill.name}</span>
                                                <Icon
                                                    icon={openSkillName === skill.name
                                                        ? 'mdi:chevron-down'
                                                        : 'mdi:chevron-right'}
                                                    class="size-3.5 text-[var(--theme-modal-text)]/30"
                                                />
                                            </button>
                                            {#if openSkillName === skill.name}
                                                <div
                                                    class="border-t border-white/10 px-3 py-2 text-[10px] text-[var(--theme-modal-text)]/60 leading-relaxed"
                                                >
                                                    {@html rd(skill.desc)}
                                                </div>
                                                {#if skill.values.length > 0}
                                                    <div class="border-t border-white/10 px-3 py-2 space-y-0.5">
                                                        {#each skill.values as [vname, vvalue, velement]}
                                                            <div
                                                                class="flex justify-between gap-2 text-[10px] even:bg-white/5 px-1 py-0.5 text-[var(--theme-modal-text)]/70"
                                                            >
                                                                <span class="text-[var(--theme-modal-text)]/50"
                                                                    >{vname}</span
                                                                >
                                                                <span class="tabular-nums whitespace-nowrap"
                                                                    >{vvalue}{#if velement}<span
                                                                            class="text-[var(--theme-modal-text)]/30"
                                                                        >
                                                                            {velement}</span
                                                                        >{/if}</span
                                                                >
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </section>
                        {#if charData.chains.length > 0}
                            <section>
                                <button
                                    onclick={() => handleAccordion('chains')}
                                    class="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold tracking-wider text-[var(--theme-modal-text)]/70 transition-colors hover:bg-white/10"
                                >
                                    <Icon
                                        icon={activeAccordion === 'chains' ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                        class="size-3.5"
                                    />
                                    共鸣链
                                </button>
                                {#if activeAccordion === 'chains'}
                                    <div class="mt-2 space-y-2">
                                        {#each charData.chains as chain, i}
                                            <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                                                <div class="flex items-center gap-2 text-xs font-medium">
                                                    <span class="text-[10px] text-[var(--theme-modal-text)]/40"
                                                        >C{i + 1}</span
                                                    ><span>{chain.name}</span>
                                                </div>
                                                <div
                                                    class="mt-1 text-[10px] text-[var(--theme-modal-text)]/60 leading-relaxed"
                                                >
                                                    {@html rd(chain.desc)}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </section>
                        {/if}
                    </div>
                {:else}
                    <div class="flex items-center justify-center py-16 text-xs text-[var(--theme-modal-text)]/40">
                        选择角色查看详情
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

{#if ctxShow}
    <div class="fixed inset-0 z-[80]" onclick={() => (ctxShow = false)} oncontextmenu={(e) => e.preventDefault()}>
        <div
            class="absolute min-w-36 rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
            style="left: {ctxX}px; top: {ctxY}px;"
        >
            <button
                onclick={handleCopy}
                class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)] transition-colors hover:bg-white/5"
                ><Icon icon="mdi:content-copy" class="size-3.5 shrink-0" /> 复制</button
            >
            {#if showBuffOption}
                <button
                    onclick={handleCreateBuffFromSel}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-indigo-400 transition-colors hover:bg-white/5"
                    ><Icon icon="mdi:plus" class="size-3.5 shrink-0" /> 以此为名创建BUFF</button
                >
            {/if}
            {#if showCustomHitOption}
                <button
                    onclick={handleCreateCustomHit}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-amber-400 transition-colors hover:bg-white/5"
                    ><Icon icon="mdi:plus-circle-outline" class="size-3.5 shrink-0" /> 创建自定义直伤</button
                >
            {/if}
        </div>
    </div>
{/if}

<style>
    :global(.select-text) ::selection {
        background: var(--theme-modal-text);
        color: var(--theme-modal-bg);
    }
</style>
