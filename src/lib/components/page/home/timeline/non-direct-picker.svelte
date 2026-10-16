<script lang="ts">
    /**
     * @desc 非直伤配置弹窗（处决 / 响应 / 效应）：挂在时间轴上，为当前操作块（或参考线）标记「这一刻还发生了什么非直伤」。
     *
     * 交互约定（T-非直伤重做）：
     *  - **点头像即启用**：处决/响应没有额外的开关按钮 —— 点哪个角色的头像，就是「谁触发」，
     *    同时这一项也就启用了；再点同一头像取消。历史实现是「先点名称选中、再点头像指定触发者」两次点击，
     *    而且允许「选了响应却没指定触发者」这种写进去也建不出条目的空配置（见 `applyNonDirectEntries`）。
     *  - **不可响应的行不显示**：队里没人会该响应技能时整行不渲染；技能表还没就绪时先不隐藏（判断不出来），
     *    并顺手把技能表补齐，就绪后自动收敛。
     *  - 已配置但触发者**已不在队伍/已无该技能**时，行仍显示（否则确认时会静默删掉配置），
     *    该头像降灰划掉，点一下即移除。
     *  - 效应是「层数 + 段数」的连续量，与处决/响应同为一行一种：**层数标在滑杆拇指的胶囊上**
     *    （与词条页声骸卡片的副词条滑杆同款），段数只在有层数时出现。
     *  - 行不画边框，只靠 `data-sf` 底色浓淡区分启用/未启用。
     */
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import Avatar from '$lib/components/ui/avatar.svelte'
    import Slider from '$lib/components/ui/slider.svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from '$lib/calc/timeline.consts'
    import {
        getNonDirectPickerBlockId,
        setNonDirectPickerBlockId,
        getNonDirectPickerEffects,
        updateNonDirectPickerEffect,
        getNonDirectPickerResponders,
        setNonDirectPickerResponders,
        getNonDirectPickerBurstLayers,
        setNonDirectPickerBurstLayers,
        getNonDirectPickerTuneTrigger,
        setNonDirectPickerTuneTrigger,
        getTeamCharNames,
        charHasResponseSkill,
        isSkillCacheReady,
        ensureSkillCache,
        elementColor,
        getCharIconMap,
        applyNonDirectEntries
    } from '$lib/calc/timeline.store.svelte'

    /** @desc 效应段数上限：仅防手滑（层数为 0 时不给改，见 `updateNonDirectPickerEffect`） */
    const MAX_HITS = 99

    /** @desc 队伍成员（去重）：处决/响应的候选人就是队伍本身 */
    const teamNames = $derived([...new Set(getTeamCharNames())])
    /** @desc 技能表是否已就绪：未就绪时判断不出「谁会响应」，此时不隐藏任何响应行 */
    const skillsReady = $derived(isSkillCacheReady(teamNames))
    $effect(() => {
        if (teamNames.length > 0) void ensureSkillCache(teamNames)
    })

    const charIcons = $derived(getCharIconMap())
    /** @desc 处决与响应：交互同形（点头像 = 启用 + 指定触发者） */
    const triggerConfigs = NON_DIRECT_CONFIGS.filter((c) => c.category === '处决' || c.category === '响应')
    const effectConfigs = NON_DIRECT_CONFIGS.filter((c) => c.category === '效应')

    /** @desc 该行的候选触发者：响应按技能过滤，处决是通用机制（目标偏谐值满即可打），不做技能过滤 */
    const candidatesOf = (name: string, category: string): string[] =>
        category === '处决' || !skillsReady ? teamNames : teamNames.filter((n) => charHasResponseSkill(n, name))

    /** @desc 该行已选的触发者（处决单选，响应可多选） */
    const chosenOf = (name: string, category: string): string[] => {
        if (category === '处决') {
            const trigger = getNonDirectPickerTuneTrigger()
            return trigger ? [trigger] : []
        }
        return getNonDirectPickerResponders()[name] ?? []
    }

    /** @desc 点触发者：选中即启用、再点取消；对「已离队/已无技能」的旧触发者而言，点一下就是把它移除 */
    const toggleTrigger = (name: string, category: string, char: string) => {
        if (category === '处决') {
            setNonDirectPickerTuneTrigger(getNonDirectPickerTuneTrigger() === char ? null : char)
            return
        }
        const list = getNonDirectPickerResponders()[name] ?? []
        const next = list.includes(char) ? list.filter((n) => n !== char) : [...list, char]
        setNonDirectPickerResponders({ ...getNonDirectPickerResponders(), [name]: next })
    }

    /** @desc 行主色：跟随已选触发者的元素色（一眼看出这条响应是谁的）；未选时用分隔线色 */
    const rowColorOf = (chosen: string[]): string =>
        chosen[0] ? elementColor(chosen[0]) : 'var(--theme-divider-border)'

    /** @desc 未启用时滑杆取中性色（有层数才上元素色），避免 6 行都没数据时一列彩色胶囊抢视线 */
    const NEUTRAL_TRACK = 'color-mix(in srgb, var(--theme-modal-text) 45%, transparent)'

    /** @desc 效应行是否可见：始终可见（它本来就是「有没有层数」的入口），仅按层数区分强调 */
    const effectValueOf = (name: string) => getNonDirectPickerEffects()[name] ?? { layers: 0, hits: 1 }

    const setHits = (name: string, hits: number) =>
        updateNonDirectPickerEffect(name, { hits: Math.min(MAX_HITS, Math.max(1, hits)) })
</script>

<!-- escapable={false}：Esc 由宿主（timeline.svelte 的 window 监听）处理为「保存并关闭」，
     外壳若自行 onclose 会先清空 blockId，使 applyNonDirectEntries() 直接 return -->
<Modal
    open={getNonDirectPickerBlockId() !== null}
    onclose={() => setNonDirectPickerBlockId(null)}
    backdropClose
    layer="nested"
    escapable={false}
    blockPageShortcuts
    class="w-full max-w-xl"
>
    {#snippet title()}
        <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>配置非直伤</span>
    {/snippet}
    <div class="space-y-4">
        <!-- @desc 处决 / 响应：一行一项，行内直接点触发者的头像（不再有「先选名称再选角色」的两步） -->
        <section>
            <SectionTitle>处决 / 响应</SectionTitle>
            <div class="space-y-1">
                {#each triggerConfigs as cfg (cfg.name)}
                    {@const isTuneBreak = cfg.category === '处决'}
                    {@const chosen = chosenOf(cfg.name, cfg.category)}
                    {@const candidates = candidatesOf(cfg.name, cfg.category)}
                    {@const stale = chosen.filter((n) => !candidates.includes(n))}
                    {@const enabled = chosen.length > 0}
                    {@const accent = rowColorOf(chosen)}
                    <!-- @desc 队里没人能响应、且没有历史配置 → 整行不显示（选了也打不出伤害） -->
                    {#if candidates.length > 0 || stale.length > 0}
                        <div
                            class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1"
                            data-sf="widget"
                            data-sf-flat
                            style={enabled
                                ? `background: color-mix(in srgb, ${accent} 14%, var(--sf-mix, transparent));`
                                : '--sf-base: var(--theme-input-bg);'}
                        >
                            <span
                                class="w-20 shrink-0 truncate text-xs font-black tracking-tight {enabled
                                    ? 'text-(--theme-modal-text)'
                                    : 'text-(--theme-modal-text)/45'}">{cfg.name}</span
                            >
                            <div class="flex flex-1 flex-wrap items-center gap-1">
                                {#each candidates as name (name)}
                                    {@const selected = chosen.includes(name)}
                                    <button
                                        type="button"
                                        class="flex items-center gap-1.5 rounded-none px-1.5 py-0.5 text-[11px] transition-colors {selected
                                            ? 'font-black text-(--theme-modal-text)'
                                            : 'text-(--theme-modal-text)/55 hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)'}"
                                        style={selected
                                            ? `background: color-mix(in srgb, ${elementColor(name)} 22%, transparent);`
                                            : ''}
                                        title={selected
                                            ? `${name}：已选为触发者（点击取消）`
                                            : `点 ${name} 触发${cfg.name}`}
                                        onclick={() => toggleTrigger(cfg.name, cfg.category, name)}
                                    >
                                        <Avatar
                                            src={charIcons[name]}
                                            alt={name}
                                            size="xs"
                                            class={selected ? '' : 'opacity-50'}
                                        />
                                        <span class="whitespace-nowrap">{name}</span>
                                    </button>
                                {/each}
                                <!-- @desc 旧配置里已不在队伍（或无该技能）的触发者：降灰划掉，点一下移除 -->
                                {#each stale as name (name)}
                                    <button
                                        type="button"
                                        class="flex items-center gap-1.5 rounded-none px-1.5 py-0.5 text-[11px] text-(--theme-modal-text)/30 transition-colors hover:bg-(--theme-modal-text)/10"
                                        title="{name}：不在当前配队（或未配武器 / 已无该技能），点击移除"
                                        onclick={() => toggleTrigger(cfg.name, cfg.category, name)}
                                    >
                                        <Avatar src={charIcons[name]} alt={name} size="xs" class="opacity-30" />
                                        <span class="whitespace-nowrap line-through">{name}</span>
                                    </button>
                                {/each}
                                {#if !isTuneBreak && candidates.length === 0 && stale.length > 0}
                                    <span class="text-[10px] text-(--theme-modal-text)/35">当前队伍无人可响应</span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}
            </div>
        </section>

        <!-- @desc 效应结算：与上面同形的一行一项（名称 · 滑杆 · 段数），层数标在滑杆拇指上；段数只在有层数时出现 -->
        <section class="border-t pt-3" style="border-color: var(--theme-divider-border);">
            <SectionTitle>效应结算</SectionTitle>
            <div class="space-y-1">
                {#each effectConfigs as cfg (cfg.name)}
                    {@const value = effectValueOf(cfg.name)}
                    {@const element = NON_DIRECT_ELEMENT[cfg.name]}
                    {@const accent = element ? `var(--theme-element-${element})` : 'var(--theme-accent-bg)'}
                    {@const active = value.layers > 0}
                    <div
                        class="flex items-center gap-x-3 px-2 py-1"
                        data-sf="widget"
                        data-sf-flat
                        style={active
                            ? `background: color-mix(in srgb, ${accent} 14%, var(--sf-mix, transparent));`
                            : '--sf-base: var(--theme-input-bg);'}
                    >
                        <span
                            class="w-20 shrink-0 truncate text-xs font-black tracking-tight {active
                                ? 'text-(--theme-modal-text)'
                                : 'text-(--theme-modal-text)/45'}">{cfg.name}</span
                        >
                        <Slider
                            class="min-w-0 flex-1"
                            inline
                            thumbBadge
                            label={cfg.name}
                            value={value.layers}
                            min={0}
                            max={cfg.max}
                            valueText="{value.layers}/{cfg.max}"
                            color={active ? accent : NEUTRAL_TRACK}
                            oninput={(v) => updateNonDirectPickerEffect(cfg.name, { layers: v })}
                        />
                        {#if active}
                            <span class="flex shrink-0 items-center gap-1">
                                <span class="text-[10px] text-(--theme-modal-text)/40">段数</span>
                                <Button
                                    variant="icon"
                                    size="none"
                                    pad="p-0.5"
                                    bare
                                    class="text-xs text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)"
                                    icon="mdi:minus"
                                    aria-label="减少段数"
                                    onclick={() => setHits(cfg.name, value.hits - 1)}
                                />
                                <span class="w-4 text-center text-xs tabular-nums text-(--theme-modal-text)"
                                    >{value.hits}</span
                                >
                                <Button
                                    variant="icon"
                                    size="none"
                                    pad="p-0.5"
                                    bare
                                    class="text-xs text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)"
                                    icon="mdi:plus"
                                    aria-label="增加段数"
                                    onclick={() => setHits(cfg.name, value.hits + 1)}
                                />
                            </span>
                        {/if}
                    </div>
                    {#if cfg.name === '电磁效应' && active}
                        {@const burstLayers = getNonDirectPickerBurstLayers()['burst'] ?? 0}
                        <div
                            class="ml-6 flex items-center gap-x-3 px-2 py-1"
                            style="--sf-base: var(--theme-input-bg);"
                            data-sf="widget"
                            data-sf-flat
                        >
                            <span
                                class="w-16 shrink-0 truncate text-xs font-black tracking-tight text-(--theme-modal-text)/70"
                                >电磁爆发</span
                            >
                            <Slider
                                class="min-w-0 flex-1"
                                inline
                                thumbBadge
                                label="电磁爆发"
                                value={burstLayers}
                                min={0}
                                max={cfg.max}
                                valueText="{burstLayers}/{cfg.max}"
                                color={accent}
                                oninput={(v) => setNonDirectPickerBurstLayers({ burst: v })}
                            />
                        </div>
                    {/if}
                {/each}
            </div>
        </section>
    </div>
    {#snippet footer()}
        <div class="mt-4 flex items-center justify-end gap-2">
            <Button
                variant="text"
                compact
                bare
                onclick={() => setNonDirectPickerBlockId(null)}
                backgroundImage="var(--theme-input-bg)"
                class="text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10">取消</Button
            >
            <Button
                variant="text"
                compact
                bare
                onclick={applyNonDirectEntries}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg, #ffffff)">确认</Button
            >
        </div>
    {/snippet}
</Modal>
