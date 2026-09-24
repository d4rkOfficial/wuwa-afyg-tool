<script lang="ts">
    /**
     * @desc 库街区同步预览/确认弹窗（企业级卡片风）：
     *  - 头像叠底的大卡片、四列排布，点卡片即选/取消（无勾选框、无打勾）
     *  - 属性分组小标题用属性图片；被跳过的角色也以灰化卡片混在同一列表里（不可选）
     *  - 整个弹窗只有一个滚动条（由 Modal 的 footer 模式提供），刷新按钮在底栏最左侧
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import MagazineCard from '$lib/components/layout/magazine/magazine-card.svelte'
    import { ELEMENT_COLORS, ELEMENT_ORDER } from '$lib/consts/game-terms'
    import type { Character } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import { KURO_PLAN_NAME, type KuroPlanPick, type KuroSyncPreview } from '$lib/kuro-app/kuro-sync.svelte'
    import type { KuroPlanDraft } from '$lib/kuro-app/kuro-plan'
    import { KURO_REFRESH_COOLDOWN_MS } from '$lib/kuro-app/kuro-echo-cache.svelte'
    import { abbrevMainStat } from '$lib/utils/substat-abbrev'

    interface Props extends ComponentsProps {
        open: boolean
        preview: KuroSyncPreview | null
        /** @desc 工具箱角色名录（取星级 / 属性，用于分组排序） */
        characters?: Character[]
        /** @desc 角色头像表（角色名 → 图像地址） */
        icons?: Record<string, string>
        /** @desc 属性图标表（属性名 → 图像地址），用作分组小标题图标 */
        elementIcons?: Record<string, string>
        /** @desc 数据取自本地暂存（没有请求上游） */
        fromCache?: boolean
        /** @desc 数据取到的时间戳 */
        fetchedAt?: number
        /** @desc 手动刷新上游数据（内部 5 分钟限流） */
        onrefresh?: () => void
        /** @desc 写入中：禁用确认按钮 */
        busy?: boolean
        onconfirm: (opts: { planName: string; picks: KuroPlanPick[] }) => void
        onclose: () => void
    }

    let {
        open,
        preview,
        characters = [],
        icons = {},
        elementIcons = {},
        fromCache = false,
        fetchedAt = 0,
        onrefresh,
        busy = false,
        onconfirm,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()

    let planName = $state(KURO_PLAN_NAME)
    /** @desc 选中的角色（按上游名定位；默认一张都不选） */
    let picked = $state<string[]>([])
    /** @desc 需要指定形态的角色：上游名 → 选中的工具箱角色名（如漂泊者的属性） */
    let forms = $state<Record<string, string>>({})
    /** @desc 上一份预览：只在预览对象变化时重置选择，避免用户手动取消后被重新选上 */
    let lastPreview: KuroSyncPreview | null = null

    $effect(() => {
        const p = preview
        if (!p || p === lastPreview) return
        lastPreview = p
        picked = []
        forms = Object.fromEntries(
            p.plans.filter((plan) => plan.options?.length).map((plan) => [plan.upstreamName, plan.options?.[0] ?? ''])
        )
        planName = KURO_PLAN_NAME
    })

    /** @desc 刷新冷却：由数据时间戳推算（弹窗打开期间每 30s 走一次，保证文案跟着变） */
    let now = $state(Date.now())
    let prevOpen = false
    $effect(() => {
        if (open && !prevOpen) now = Date.now()
        prevOpen = open
        if (!open) return
        const timer = setInterval(() => (now = Date.now()), 30000)
        return () => clearInterval(timer)
    })
    const cooldownLeft = $derived(fetchedAt ? Math.max(0, KURO_REFRESH_COOLDOWN_MS - (now - fetchedAt)) : 0)
    const cooldownText = $derived(cooldownLeft > 0 ? `${Math.ceil(cooldownLeft / 60000)} 分钟后可刷新` : '')
    const fetchedAtText = $derived(
        fetchedAt
            ? new Date(fetchedAt).toLocaleString('zh-CN', {
                  hour12: false,
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
              })
            : ''
    )

    /** @desc 角色名 → 名录条目（星级 / 属性） */
    const charByName = $derived(new Map(characters.map((c) => [c.name, c])))
    const elementOf = (name: string, fallback?: string) => fallback || charByName.get(name)?.element || ''
    const starOf = (name: string) => charByName.get(name)?.star ?? 0
    const elementColor = (name: string, fallback?: string) =>
        ELEMENT_COLORS[elementOf(name, fallback)] ?? 'var(--theme-accent-bg)'

    const isPicked = (upstreamName: string) => picked.includes(upstreamName)
    const toggle = (upstreamName: string) => {
        picked = isPicked(upstreamName) ? picked.filter((k) => k !== upstreamName) : [...picked, upstreamName]
    }

    /** @desc 该角色最终写入用的名字：需要指定形态时取 badge 选中值 */
    const characterOf = (plan: KuroPlanDraft) =>
        plan.options?.length ? (forms[plan.upstreamName] ?? '') : plan.character

    /** @desc 确认时把「上游名 → 写入角色名」一起带上，避免漂泊者写错属性 */
    const collectPicks = (): KuroPlanPick[] =>
        (preview?.plans ?? [])
            .filter((plan) => isPicked(plan.upstreamName))
            .map((plan) => ({ upstreamName: plan.upstreamName, character: characterOf(plan) }))
            .filter((pick) => !!pick.character)

    /** @desc 方案 cost 布局：43311 / 33111 / 44111（按 cost 从大到小） */
    const costString = (plan: KuroPlanDraft) =>
        plan.slots
            .map((s) => s.cost)
            .sort((a, b) => b - a)
            .join('')

    /** @desc 五个部位的主词条简写（缺主词条的部位留一条淡横线） */
    const slotLines = (plan: KuroPlanDraft) =>
        plan.slots.map((slot) => ({
            cost: slot.cost,
            label: slot.mainStat ? abbrevMainStat(slot.mainStat.type) : '',
            full: slot.mainStat ? `${slot.mainStat.type}${slot.mainStat.value}${slot.mainStat.unit}` : '未选主词条'
        }))

    /**
     * @desc 卡片头像：主角（漂泊者）统一用**衍射**属性的头像；其余用角色自己的头像
     *  （上游只给「漂泊者」时它没有形态名，所以固定取 漂泊者·衍射）
     */
    const avatarOf = (name: string, hasOptions: boolean): string | undefined => {
        if (hasOptions || name.startsWith('漂泊者')) {
            return icons['漂泊者·衍射'] ?? icons[name]
        }
        return icons[name]
    }

    /** @desc 统一卡片列表：可写入的方案卡 + 灰化的跳过卡，按属性分组（漂泊者/多形态排最前） */
    const groups = $derived.by(() => {
        const plans = preview?.plans ?? []
        const skipped = preview?.skipped ?? []
        interface Card {
            key: string
            name: string
            element: string
            star: number
            plan?: KuroPlanDraft
            reason?: string
        }
        const cards: Card[] = [
            ...plans.map((plan) => ({
                key: plan.upstreamName,
                name: plan.options?.length ? plan.upstreamName : plan.character || plan.upstreamName,
                element: elementOf(plan.character || plan.upstreamName, plan.element),
                star: starOf(plan.character),
                plan
            })),
            ...skipped.map((s) => ({
                key: `skip:${s.character}`,
                name: s.character,
                element: elementOf(s.character, s.element),
                star: starOf(s.character),
                reason: s.reason
            }))
        ]
        const multi = cards.filter((c) => c.plan?.options?.length)
        const rest = cards.filter((c) => !c.plan?.options?.length)
        const byElement = new Map<string, Card[]>()
        for (const card of rest) {
            const key = card.element || '其它'
            const bucket = byElement.get(key)
            if (bucket) bucket.push(card)
            else byElement.set(key, [card])
        }
        const sortCards = (list: Card[]) =>
            [...list].sort(
                (a, b) =>
                    (a.plan ? 0 : 1) - (b.plan ? 0 : 1) || b.star - a.star || a.name.localeCompare(b.name, 'zh-Hans-CN')
            )
        const out: { key: string; cards: Card[] }[] = []
        if (multi.length > 0) out.push({ key: 'multi', cards: sortCards(multi) })
        for (const element of [...ELEMENT_ORDER, '其它'] as string[]) {
            const list = byElement.get(element)
            if (list?.length) out.push({ key: element, cards: sortCards(list) })
        }
        return out
    })
</script>

<Modal {open} {onclose} hideClose class={className} style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:account-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="text-base font-black tracking-wide text-(--theme-modal-text)">从库街区同步</span>
            {#if preview}
                <span class="text-[11px] tracking-[0.18em] text-(--theme-modal-text)/40"
                    >来源 · {preview.roleName} · 上游 {preview.upstreamCount} 个角色{#if fetchedAtText}
                        · 数据 {fetchedAtText}{fromCache ? '（暂存）' : ''}{/if}</span
                >
            {/if}
        </span>
    {/snippet}

    <div class="w-[min(96vw,74rem)] space-y-3">
        <div class="flex flex-wrap items-end gap-3">
            <label class="block min-w-[16rem] flex-1">
                <span class="mb-1 block text-[10px] tracking-[0.18em] text-(--theme-modal-text)/40"
                    >方案名（同名方案会被覆盖）</span
                >
                <input
                    bind:value={planName}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </label>
            {#if preview}
                <span class="pb-1 text-[11px] text-(--theme-modal-text)/40">
                    已选 <b class="text-base text-(--theme-accent-text)">{picked.length}</b> / {preview.plans.length}
                </span>
            {/if}
        </div>

        {#if preview}
            <p class="text-[10px] tracking-[0.18em] text-(--theme-modal-text)/30">
                点击卡片选择要写入的角色（灰化卡片是没有声骸数据、无法写入的角色）
            </p>

            <div class="space-y-4">
                {#each groups as group (group.key)}
                    <div>
                        <div class="mb-2 flex items-center gap-2">
                            {#if elementIcons[group.key]}
                                <img src={elementIcons[group.key]} alt="" class="size-5 shrink-0 object-contain" />
                            {/if}
                            <span class="text-sm font-black tracking-[0.22em] text-(--theme-modal-text)/70"
                                >{group.key}</span
                            >
                            <span class="text-[10px] tracking-[0.18em] text-(--theme-modal-text)/30"
                                >{group.cards.length}</span
                            >
                            <span
                                class="h-px flex-1"
                                style="background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                            ></span>
                        </div>
                        <div class="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                            {#each group.cards as card (card.key)}
                                {@const plan = card.plan}
                                {@const selected = !!plan && isPicked(plan.upstreamName)}
                                {@const accent = elementColor(card.name, card.element)}
                                {@const avatar = avatarOf(card.name, !!plan?.options?.length)}
                                <MagazineCard
                                    active={selected}
                                    onclick={plan ? () => toggle(plan.upstreamName) : undefined}
                                    style="border-color: {selected
                                        ? `color-mix(in srgb, ${accent} 65%, transparent)`
                                        : 'var(--theme-card-border)'}; --sf-base: {selected
                                        ? `color-mix(in srgb, ${accent} 14%, var(--theme-card-bg))`
                                        : 'var(--theme-card-bg)'}; opacity: {plan ? 1 : 0.45};"
                                >
                                    <!-- 角色头像叠底（放大，右下渐隐） -->
                                    {#if avatar}
                                        <div
                                            class="pointer-events-none absolute -right-4 -bottom-6 z-0 size-40 transition-opacity"
                                            style="opacity: {selected
                                                ? 0.62
                                                : 0.38}; -webkit-mask-image: linear-gradient(to left, transparent, #000 42%), linear-gradient(to top, transparent, #000 38%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 42%), linear-gradient(to top, transparent, #000 38%); mask-composite: intersect;"
                                        >
                                            <img src={avatar} alt="" class="size-full object-cover" />
                                        </div>
                                    {/if}

                                    <div class="relative z-10 flex min-h-[12.5rem] flex-col p-3">
                                        <!-- 名字 + 漂泊者属性 badge -->
                                        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                            <span
                                                class="max-w-full truncate text-xl leading-tight font-black tracking-tight text-(--theme-modal-text)"
                                                style="text-shadow: 0 0 5px var(--theme-halo-color);"
                                                title={plan?.matched === false
                                                    ? `工具箱名录里没有「${plan.upstreamName}」，将按上游名写入`
                                                    : card.name}>{card.name}</span
                                            >
                                            {#if plan?.options?.length}
                                                {#each plan.options as opt (opt)}
                                                    {@const active = (forms[plan.upstreamName] ?? '') === opt}
                                                    {@const color =
                                                        ELEMENT_COLORS[elementOf(opt)] ?? 'var(--theme-accent-bg)'}
                                                    <button
                                                        type="button"
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            forms[plan.upstreamName] = opt
                                                            if (!isPicked(plan.upstreamName)) {
                                                                picked = [...picked, plan.upstreamName]
                                                            }
                                                        }}
                                                        class="rounded-none border px-1.5 py-px text-[10px] font-black tracking-wide transition-colors"
                                                        style="border-color: {active
                                                            ? color
                                                            : `color-mix(in srgb, ${color} 35%, transparent)`}; color: {active
                                                            ? color
                                                            : `color-mix(in srgb, ${color} 70%, var(--theme-modal-text))`}; background: {active
                                                            ? `color-mix(in srgb, ${color} 18%, transparent)`
                                                            : 'transparent'};"
                                                        title="写入为 {opt}"
                                                    >
                                                        {elementOf(opt) || opt}
                                                    </button>
                                                {/each}
                                            {/if}
                                        </div>

                                        {#if plan}
                                            <!-- 五个部位的主词条简写 -->
                                            <div
                                                class="mt-2.5 space-y-1 border-t pt-2.5"
                                                style="border-color: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                            >
                                                {#each slotLines(plan) as line, i (i)}
                                                    <div class="flex items-center gap-2 text-xs leading-5">
                                                        <span
                                                            class="flex h-5 w-9 shrink-0 items-center justify-center text-[11px] font-black tabular-nums"
                                                            style="background: color-mix(in srgb, {accent} 16%, transparent); color: {accent};"
                                                            >{line.cost}C</span
                                                        >
                                                        {#if line.label}
                                                            <span
                                                                class="min-w-0 truncate font-black text-(--theme-modal-text)/85"
                                                                title={line.full}>{line.label}</span
                                                            >
                                                        {:else}
                                                            <span class="text-(--theme-modal-text)/20">—</span>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>

                                            <!-- cost 布局 -->
                                            <div
                                                class="mt-auto flex items-end justify-between gap-2 border-t pt-2.5"
                                                style="border-color: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                            >
                                                <span
                                                    class="text-xl leading-none font-black tracking-[0.14em] tabular-nums"
                                                    style="color: {accent};"
                                                    title="声骸 cost 布局">{costString(plan)}</span
                                                >
                                                {#if plan.echoCount < 5}
                                                    <span
                                                        class="text-[11px] font-black tracking-[0.14em] tabular-nums text-(--theme-modal-text)/45"
                                                        >声骸 {plan.echoCount}/5</span
                                                    >
                                                {/if}
                                            </div>
                                        {:else}
                                            <!-- 灰化卡片：不可选，只说明为什么没有方案 -->
                                            <div class="mt-auto pt-2.5">
                                                <span
                                                    class="block border-t pt-2 text-[11px] font-black text-(--theme-modal-text)/45"
                                                    style="border-color: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                                    >{card.reason ?? '无法写入'}</span
                                                >
                                            </div>
                                        {/if}
                                    </div>
                                </MagazineCard>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>

            {#if preview.unmatchedNames.length > 0}
                <div class="text-[11px] text-red-400">
                    未识别的词条名：{preview.unmatchedNames.join('、')}（这些词条不会写入方案）
                </div>
            {/if}
        {:else}
            <div class="py-6 text-center text-xs text-(--theme-modal-text)/40">没有可同步的数据</div>
        {/if}
    </div>

    {#snippet footer()}
        <div class="flex items-center gap-2 pt-3">
            {#if onrefresh}
                <button
                    onclick={onrefresh}
                    disabled={busy || cooldownLeft > 0}
                    class="flex items-center gap-1.5 rounded-none border px-2.5 py-1.5 text-xs font-black text-(--theme-modal-text)/70 transition-colors hover:text-(--theme-modal-text) disabled:opacity-40"
                    style="border-color: var(--theme-divider-border);"
                    title={cooldownLeft > 0
                        ? `同一份数据 5 分钟只能刷新一次（${cooldownText}）`
                        : '重新从库街区拉取一次声骸数据'}
                >
                    <Icon
                        icon={busy ? 'mdi:loading' : 'mdi:refresh'}
                        class={busy ? 'size-3.5 animate-spin' : 'size-3.5'}
                    />
                    刷新数据
                    {#if cooldownLeft > 0}<span class="text-[10px] font-normal">（{cooldownText}）</span>{/if}
                </button>
            {/if}
            <div class="ml-auto flex items-center gap-2">
                <button
                    onclick={onclose}
                    class="rounded-none border px-3 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    取消
                </button>
                <button
                    onclick={() => onconfirm({ planName, picks: collectPicks() })}
                    disabled={busy || picked.length === 0}
                    class="flex items-center gap-1.5 rounded-none px-3 py-1.5 text-xs font-black transition-all hover:brightness-125 disabled:opacity-40"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                >
                    <Icon
                        icon={busy ? 'mdi:loading' : 'mdi:download'}
                        class={busy ? 'size-3.5 animate-spin' : 'size-3.5'}
                    />
                    写入 {picked.length} 个方案
                </button>
            </div>
        </div>
    {/snippet}
</Modal>
