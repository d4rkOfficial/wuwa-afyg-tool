<script lang="ts">
    /**
     * @desc 库街区同步预览/确认弹窗（杂志卡片风，参考「从工坊导入」）：
     *  角色头像叠底 + 五个部位主词条简写的卡片、四列排布，点卡片即选/取消（无勾选框）。
     *  - 只有完全没声骸的角色才不出卡（记在「已跳过」里）
     *  - 漂泊者排最前，属性用名字后面的属性色 badge 单选；其余按六属性分组，组内五星在前
     *  - 声骸不齐的卡片照常可选，缺主词条的部位留一条淡横线
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import MagazineCard from '$lib/components/layout/magazine/magazine-card.svelte'
    import { ELEMENT_COLORS, ELEMENT_ORDER } from '$lib/consts/game-terms'
    import type { Character } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import { KURO_PLAN_NAME, type KuroPlanPick, type KuroSyncPreview } from '$lib/kuro-app/kuro-sync.svelte'
    import type { KuroPlanDraft } from '$lib/kuro-app/kuro-plan'
    import { abbrevMainStat } from '$lib/utils/substat-abbrev'

    interface Props extends ComponentsProps {
        open: boolean
        preview: KuroSyncPreview | null
        /** @desc 工具箱角色名录（取星级 / 属性，用于分组排序） */
        characters?: Character[]
        /** @desc 角色头像表（角色名 → 图像地址） */
        icons?: Record<string, string>
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

    /** @desc 角色名 → 名录条目（星级 / 属性） */
    const charByName = $derived(new Map(characters.map((c) => [c.name, c])))
    const elementOf = (name: string) => charByName.get(name)?.element ?? ''
    const starOf = (name: string) => charByName.get(name)?.star ?? 0
    const elementColor = (name: string) => ELEMENT_COLORS[elementOf(name)] ?? 'var(--theme-accent-bg)'

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

    /** @desc 带形态（漂泊者）的角色排最前，其余按六属性分组，组内五星在前、再按名字排 */
    const groups = $derived.by(() => {
        const plans = preview?.plans ?? []
        const multi = plans.filter((p) => p.options?.length)
        const rest = plans.filter((p) => !p.options?.length)
        const byElement = new Map<string, KuroPlanDraft[]>()
        for (const plan of rest) {
            const key = elementOf(plan.character) || '其它'
            const bucket = byElement.get(key)
            if (bucket) bucket.push(plan)
            else byElement.set(key, [plan])
        }
        const sortPlans = (list: KuroPlanDraft[]) =>
            [...list].sort(
                (a, b) =>
                    starOf(b.character) - starOf(a.character) || a.character.localeCompare(b.character, 'zh-Hans-CN')
            )
        const out: { title: string; plans: KuroPlanDraft[] }[] = []
        if (multi.length > 0) out.push({ title: '', plans: sortPlans(multi) })
        for (const element of [...ELEMENT_ORDER, '其它'] as string[]) {
            const list = byElement.get(element)
            if (list?.length) out.push({ title: element, plans: sortPlans(list) })
        }
        return out
    })

    const allKeys = $derived((preview?.plans ?? []).map((p) => p.upstreamName))
    const allPicked = $derived(allKeys.length > 0 && picked.length === allKeys.length)

    /** @desc 选属性 = 同时把这张卡片选上（免得只点了属性却忘了选卡片） */
    const pickForm = (upstreamName: string, form: string) => {
        forms[upstreamName] = form
        if (!isPicked(upstreamName)) picked = [...picked, upstreamName]
    }

    /** @desc 五个部位的主词条简写（缺主词条的部位留一条淡横线） */
    const slotLines = (plan: KuroPlanDraft) =>
        plan.slots.map((slot) => ({
            cost: slot.cost,
            label: slot.mainStat ? abbrevMainStat(slot.mainStat.type) : '',
            full: slot.mainStat ? `${slot.mainStat.type}${slot.mainStat.value}${slot.mainStat.unit}` : '未选主词条'
        }))
</script>

<Modal {open} {onclose} class={className} style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:account-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="text-base font-black tracking-wide text-(--theme-modal-text)">从库街区同步</span>
            {#if preview}
                <span class="text-[11px] tracking-[0.18em] text-(--theme-modal-text)/40"
                    >来源 · {preview.roleName} · 上游 {preview.upstreamCount} 个角色</span
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
                <div class="flex items-center gap-2 pb-0.5 text-[11px] text-(--theme-modal-text)/40">
                    <span>
                        已选 <b class="text-base text-(--theme-accent-text)">{picked.length}</b> / {preview.plans
                            .length}
                        {#if preview.skipped.length > 0}· 跳过 {preview.skipped.length}{/if}
                    </span>
                    <button
                        onclick={() => (picked = allPicked ? [] : allKeys)}
                        class="rounded-none border px-2 py-0.5 text-[11px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                    >
                        {allPicked ? '全不选' : '全选'}
                    </button>
                </div>
            {/if}
        </div>

        {#if preview}
            <p class="text-[10px] tracking-[0.18em] text-(--theme-modal-text)/30">点击卡片选择要写入的角色</p>

            <div class="theme-scrollbar max-h-[62vh] space-y-4 overflow-y-auto pr-1">
                {#each groups as group (group.title || 'multi')}
                    <div>
                        {#if group.title}
                            <div class="mb-2 flex items-center gap-2">
                                <span
                                    class="size-2 shrink-0"
                                    style="background: {ELEMENT_COLORS[group.title] ?? 'var(--theme-divider-border)'};"
                                ></span>
                                <span class="text-sm font-black tracking-[0.22em] text-(--theme-modal-text)/70"
                                    >{group.title}</span
                                >
                                <span class="text-[10px] tracking-[0.18em] text-(--theme-modal-text)/30"
                                    >{group.plans.length}</span
                                >
                                <span
                                    class="h-px flex-1"
                                    style="background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                ></span>
                            </div>
                        {/if}
                        <div class="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
                            {#each group.plans as plan (plan.upstreamName)}
                                {@const label = characterOf(plan) || plan.upstreamName}
                                {@const avatar = icons[label]}
                                {@const selected = isPicked(plan.upstreamName)}
                                {@const accent = elementColor(label)}
                                <MagazineCard
                                    active={selected}
                                    watermark={elementOf(label) || undefined}
                                    onclick={() => toggle(plan.upstreamName)}
                                    style="border-color: {selected
                                        ? `color-mix(in srgb, ${accent} 65%, transparent)`
                                        : 'var(--theme-card-border)'};"
                                >
                                    <!-- 角色头像叠底（右下，边缘淡出） -->
                                    {#if avatar}
                                        <div
                                            class="pointer-events-none absolute -right-3 -bottom-4 z-0 size-28 transition-opacity"
                                            style="opacity: {selected
                                                ? 0.5
                                                : 0.28}; -webkit-mask-image: linear-gradient(to left, transparent, #000 45%), linear-gradient(to top, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 45%), linear-gradient(to top, transparent, #000 40%); mask-composite: intersect;"
                                        >
                                            <img src={avatar} alt="" class="size-full object-cover" />
                                        </div>
                                    {/if}

                                    <div class="relative z-10 flex min-h-[11rem] flex-col p-2.5">
                                        <!-- 名字 + 漂泊者属性 badge -->
                                        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                            <span
                                                class="max-w-full truncate text-lg leading-tight font-black tracking-tight text-(--theme-modal-text)"
                                                style="text-shadow: 0 0 4px var(--theme-halo-color);"
                                                title={plan.matched
                                                    ? plan.character
                                                    : `工具箱名录里没有「${plan.upstreamName}」，将按上游名写入`}
                                                >{plan.options?.length ? plan.upstreamName : plan.character}</span
                                            >
                                            {#if plan.options?.length}
                                                {#each plan.options as opt (opt)}
                                                    {@const active = (forms[plan.upstreamName] ?? '') === opt}
                                                    {@const color =
                                                        ELEMENT_COLORS[elementOf(opt)] ?? 'var(--theme-accent-bg)'}
                                                    <button
                                                        type="button"
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            pickForm(plan.upstreamName, opt)
                                                        }}
                                                        class="rounded-none border px-1 py-px text-[10px] font-black tracking-wide transition-colors"
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

                                        <!-- 五个部位的主词条简写 -->
                                        <div class="mt-1.5 space-y-0.5">
                                            {#each slotLines(plan) as line, i (i)}
                                                <div class="flex items-baseline gap-1.5 text-[11px] leading-4">
                                                    <span
                                                        class="w-6 shrink-0 tabular-nums"
                                                        style="color: color-mix(in srgb, {accent} 85%, var(--theme-modal-text));"
                                                        >{line.cost}C</span
                                                    >
                                                    {#if line.label}
                                                        <span
                                                            class="min-w-0 truncate font-black text-(--theme-modal-text)/80"
                                                            title={line.full}>{line.label}</span
                                                        >
                                                    {:else}
                                                        <span class="text-(--theme-modal-text)/20">—</span>
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>

                                        <!-- 底部：cost 布局 + 声骸数量 + 选中标记 -->
                                        <div class="mt-auto flex items-end justify-between gap-2 pt-2.5">
                                            <span
                                                class="text-sm font-black tracking-[0.2em] tabular-nums"
                                                style="color: {accent};"
                                                title="声骸 cost 布局">{costString(plan)}</span
                                            >
                                            {#if plan.echoCount < 5}
                                                <span
                                                    class="text-[10px] tracking-[0.18em] tabular-nums text-(--theme-modal-text)/40"
                                                    >声骸 {plan.echoCount}/5</span
                                                >
                                            {/if}
                                            <span
                                                class="ml-auto flex size-4 shrink-0 items-center justify-center border transition-colors"
                                                style="border-color: {selected
                                                    ? accent
                                                    : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'}; background: {selected
                                                    ? accent
                                                    : 'transparent'};"
                                            >
                                                {#if selected}
                                                    <Icon
                                                        icon="mdi:check"
                                                        class="size-3"
                                                        style="color: var(--theme-card-bg);"
                                                    />
                                                {/if}
                                            </span>
                                        </div>
                                    </div>
                                </MagazineCard>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>

            {#if preview.skipped.length > 0}
                <div
                    class="rounded-none border px-2.5 py-2 text-[11px]"
                    style="border-color: var(--theme-divider-border);"
                >
                    <div class="mb-1 font-black tracking-[0.18em] text-(--theme-modal-text)/60">已跳过</div>
                    <div class="space-y-0.5 text-(--theme-modal-text)/40">
                        {#each preview.skipped as s (s.character)}
                            <div>· {s.character}：{s.reason}</div>
                        {/each}
                    </div>
                </div>
            {/if}

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
        <div class="flex items-center justify-end gap-2">
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
    {/snippet}
</Modal>
