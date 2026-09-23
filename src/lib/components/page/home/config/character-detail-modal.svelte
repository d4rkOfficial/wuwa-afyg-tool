<script lang="ts">
    import type { CharSlot } from '$lib/types/project'
    import type { ComponentsProps } from '$lib/types'
    import type { ConfigState } from '$lib/calc/config.types'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/api/data-cache'
    import { ELEMENT_ORDER, DAMAGE_TYPES } from '$lib/consts/game-terms'
    import {
        getConditionProfile,
        setConditionProfileChains,
        setConditionProfileRefinements
    } from '$lib/calc/calculation.store.svelte'
    import { computeCharStats, charElementColorOf, formatWeaponSubstat, type CharStats } from './character-detail-utils'
    import Modal from '$lib/components/layout/modal.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import Icon from '@iconify/svelte'
    import { openHelp } from '$lib/data/help.svelte'

    /** @desc 面板类型加成固定展示顺序：普攻/重击/共鸣技能/共鸣解放/变奏/延奏/声骸/协同，效应与其它不展示 */
    const TYPE_DMG_ORDER = DAMAGE_TYPES.filter((dt) => dt !== '效应伤害' && dt !== '其它类型伤害')

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        configState: ConfigState | null
        calcState: CalcState | null
        onclose?: () => void
        /** @desc 链/阶档位变更后的回调（+page 注入，供「链/阶变动重载数据」使用） */
        onProfileReload?: () => void
    }

    let {
        open,
        onclose,
        onProfileReload,
        team,
        configState,
        calcState,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let activeTab = $state(0)

    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let loading = $state(true)

    // 每次打开都重新加载（api 层有内存 + localStorage 缓存，成本低），并跟随队伍变化重载；
    // 避免一次性 loaded 标志导致换队伍/换工程后信息陈旧，一直显示「未配置角色」
    let prevOpen = $state(false)
    let loadedTeamKey = $state('')
    let teamKey = $derived(team.map((s) => `${s.character ?? ''}|${s.weapon ?? ''}`).join('~'))

    const loadInfo = async () => {
        const key = teamKey
        loadedTeamKey = key
        loading = true
        charInfoMap = {}
        weaponInfoMap = {}
        const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)
        const weaponNames = team.map((s) => s.weapon).filter((w): w is string => w !== null)
        Promise.allSettled([getCharacterIcons(), getWeaponIcons()]).then(([ci, wi]) => {
            if (ci.status === 'fulfilled') charIcons = ci.value
            if (wi.status === 'fulfilled') weaponIcons = wi.value
        })
        const [cinfos, winfos] = await Promise.all([
            Promise.all(charNames.map((n) => getCharacterInfo(n).catch(() => null))),
            Promise.all(weaponNames.map((n) => getWeaponInfo(n).catch(() => null)))
        ])
        // 返回时若已切到别的队伍/重新加载，丢弃本次结果
        if (loadedTeamKey !== key) return
        const cmap: Record<string, CharacterInfo> = {}
        for (let i = 0; i < charNames.length; i++) {
            if (cinfos[i]) cmap[charNames[i]] = cinfos[i]!
        }
        charInfoMap = cmap
        const wmap: Record<string, WeaponInfo> = {}
        for (let i = 0; i < weaponNames.length; i++) {
            if (winfos[i]) wmap[weaponNames[i]] = winfos[i]!
        }
        weaponInfoMap = wmap
        loading = false
    }

    $effect(() => {
        const firstOpen = open && !prevOpen
        prevOpen = open
        if (firstOpen) activeTab = 0
        if (open && (firstOpen || teamKey !== loadedTeamKey)) loadInfo()
    })

    const conditionProfile = $derived(getConditionProfile())

    /** @desc 链/阶档位：点选即写入并触发重载；点当前档位不重复写入（避免无谓重载） */
    const savedChain = $derived(conditionProfile.chains[activeTab] ?? 0)
    const savedRefine = $derived(conditionProfile.refinements[activeTab] ?? 1)

    function pickChain(n: number) {
        if (n === savedChain) return
        setConditionProfileChains(activeTab, n)
        onProfileReload?.()
    }

    function pickRefine(n: number) {
        if (n === savedRefine) return
        setConditionProfileRefinements(activeTab, n)
        onProfileReload?.()
    }

    /** @desc 链/阶生效条件帮助文案（武器行问号按钮调起全局帮助面板） */
    let refineHelpItems = [
        {
            name: '生效条件总则',
            description: '角色看共鸣链、武器看精炼',
            content: '低于生效条件（角色 buff 看共鸣链、武器 buff 看佩戴者武器精炼）的 buff 不生效，实时反映在结果中。'
        },
        {
            name: '角色共鸣链',
            description: '共鸣链 ≥ n链 才生效',
            content:
                '带共鸣链条件的角色 buff（如「一链」效果）要求该角色共鸣链档位 ≥ n（0-6）。档位低于条件的 buff 不生效。'
        },
        {
            name: '武器精炼',
            description: '武器 ≥ n阶 才生效（含 0 阶特殊情况说明）',
            content:
                '带精炼条件的武器 buff 要求佩戴者武器精炼档位 ≥ n（0-5）。默认档位为 1 阶。通常来说，奶妈带专武但想模拟协奏武器时，武器阶数设置为0阶。'
        }
    ]

    let stats = $derived<Array<CharStats | null>>(
        team.map((slot, i) => computeCharStats(slot, i, charInfoMap, weaponInfoMap, configState, calcState))
    )

    const slot = $derived(team[activeTab])
    const charName = $derived(slot?.character ?? null)
    const stat = $derived(stats[activeTab])
    // 是否存在任一「加成」项（元素/类型/全属性），用于在面板数据与加成分组间渲染分割线
    const hasBonus = $derived(
        !!stat &&
            (stat.bonusDmg > 0 ||
                ELEMENT_ORDER.some((el) => (stat.elementDmg[el] ?? 0) > 0) ||
                TYPE_DMG_ORDER.some((dt) => (stat.typeDmg[dt.replace('伤害', '')] ?? 0) > 0))
    )
</script>

<Modal
    {open}
    {onclose}
    class={className}
    style="width: min(92vw, 520px); {backgroundImage ? `background: ${backgroundImage}` : ''}; {textColor
        ? `color: ${textColor}`
        : ''}; {styleProp || ''}"
>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:account-details" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            角色详情配置
        </span>
    {/snippet}

    <div class="flex gap-2">
        {#each [0, 1, 2] as i}
            {@const name = team[i].character}
            <button
                onclick={() => (activeTab = i)}
                class={[
                    'rounded-none border px-3 py-1.5 text-xs font-black tracking-tight transition-colors flex items-center gap-2',
                    activeTab === i && 'border-current',
                    activeTab !== i &&
                        'border-transparent text-(--theme-modal-text)/40 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/70'
                ].join(' ')}
                style={activeTab === i
                    ? `background: color-mix(in srgb, ${charElementColorOf(name ?? '', charInfoMap)} 18%, transparent); color: ${charElementColorOf(name ?? '', charInfoMap)};`
                    : ''}
            >
                {#if name}
                    {#if charIcons[name]}
                        <img
                            src={charIcons[name]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class="size-5 rounded-full shrink-0"
                        />
                    {:else}
                        <span
                            class="size-5 rounded-full bg-(--theme-modal-text)/10 flex items-center justify-center text-[10px] shrink-0"
                        >
                            {name.charAt(0)}
                        </span>
                    {/if}
                    <span>{name}</span>
                {:else}
                    <span class="shrink-0 text-[10px] opacity-60">角色 {i + 1}</span>
                {/if}
            </button>
        {/each}
    </div>

    {#if loading}
        <div class="mt-6 flex items-center justify-center gap-2 py-10">
            <Icon icon="mdi:loading" class="size-5 animate-spin text-(--theme-modal-text)/40" />
            <span class="text-xs text-(--theme-modal-text)/40">加载中…</span>
        </div>
    {:else if !charName}
        <div
            class="mt-4 flex flex-col items-center gap-2 rounded-none border border-dashed py-10"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:account-question-outline" class="size-7 text-(--theme-modal-text)/30" />
            <span class="text-xs text-(--theme-modal-text)/40">未配置角色</span>
        </div>
    {:else if !stat}
        <div
            class="mt-4 flex flex-col items-center gap-2 rounded-none border border-dashed py-10"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:alert-circle-outline" class="size-7 text-(--theme-modal-text)/30" />
            <span class="text-xs text-(--theme-modal-text)/40">角色信息加载失败</span>
            <button
                onclick={loadInfo}
                class="mt-1 inline-flex items-center gap-1 rounded-none px-3 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                <Icon icon="mdi:refresh" class="size-3" />
                重试
            </button>
        </div>
    {:else}
        <!-- 角色头 -->
        <div
            class="mt-4 flex items-center gap-3 rounded-none border p-3"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="flex min-w-0 items-center gap-3">
                {#if charIcons[charName]}
                    <img
                        src={charIcons[charName]}
                        alt={charName}
                        use:fallbackIcon={'/icons/placeholder-character.svg'}
                        class="size-11 shrink-0 rounded-full object-cover"
                    />
                {:else}
                    <span
                        class="size-11 shrink-0 rounded-full flex items-center justify-center text-sm font-black"
                        style="background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 50%, transparent);"
                    >
                        {charName.charAt(0)}
                    </span>
                {/if}
                <span class="block text-sm font-black" style="color: {charElementColorOf(charName, charInfoMap)}">
                    {charName}
                </span>
            </div>

            <div class="h-10 w-px shrink-0" style="background: var(--theme-divider-border);"></div>

            <!-- 武器 -->
            <div class="flex min-w-0 flex-1 items-center gap-2.5">
                <div
                    class="flex size-11 shrink-0 items-center justify-center rounded-none border"
                    style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                >
                    {#if stat.weapon && weaponIcons[stat.weapon]}
                        <img
                            src={weaponIcons[stat.weapon]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                            class="size-8 object-contain"
                        />
                    {:else}
                        <img src="/icons/placeholder-weapon.svg" alt="" class="size-8 object-contain opacity-60" />
                    {/if}
                </div>
                {#if stat.weapon}
                    {@const wInfo = weaponInfoMap[stat.weapon]}
                    <div class="min-w-0">
                        <span class="block truncate text-xs font-black text-(--theme-modal-text)/80">{stat.weapon}</span
                        >
                        <span class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40">
                            {#if wInfo}
                                攻击 +{wInfo.lv90BaseAtk} · {formatWeaponSubstat(wInfo.substat)}
                            {:else}
                                武器数据未加载
                            {/if}
                        </span>
                    </div>
                {:else}
                    <span class="text-xs text-(--theme-modal-text)/30">未配置武器</span>
                {/if}
            </div>
        </div>

        <!-- 链/阶配置：小按钮分组框（样式参考 设置-配色），框宽适应按钮；点选即写入档位并触发重载，点当前档位不重复写入 -->
        <div
            class="mt-3 rounded-none border p-3"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="flex items-center gap-2">
                <span class="w-8 shrink-0 text-[10px] text-(--theme-modal-text)/40">角色</span>
                <div
                    class="flex w-fit gap-1 rounded-none border p-1"
                    style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                >
                    {#each [0, 1, 2, 3, 4, 5, 6] as n}
                        {@const active = savedChain === n}
                        <button
                            onclick={() => pickChain(n)}
                            class="rounded-none px-2 py-1 text-[11px] font-black transition-colors {active
                                ? ''
                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                            style={active
                                ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);'
                                : ''}
                        >
                            {n}链
                        </button>
                    {/each}
                </div>
            </div>
            <div class="mt-2 flex items-center gap-2">
                <span class="w-8 shrink-0 text-[10px] text-(--theme-modal-text)/40">武器</span>
                <div
                    class="flex w-fit gap-1 rounded-none border p-1"
                    style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                >
                    {#each [0, 1, 2, 3, 4, 5] as n}
                        {@const active = savedRefine === n}
                        <button
                            onclick={() => pickRefine(n)}
                            class="rounded-none px-2 py-1 text-[11px] font-black transition-colors {active
                                ? ''
                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                            style={active
                                ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);'
                                : ''}
                            title={n === 0 ? '无专武精炼（不触发专武精炼 buff）' : undefined}
                        >
                            {n === 0 ? '无专' : `${n}阶`}
                        </button>
                    {/each}
                </div>
                <button
                    onclick={() => openHelp('链/阶生效条件说明', refineHelpItems)}
                    class="flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-(--theme-modal-text)/10"
                    style="color: var(--theme-accent-text);"
                    title="链/阶生效条件说明"
                >
                    <Icon icon="mdi:help-circle-outline" class="size-4" />
                </button>
            </div>
        </div>

        <!-- 属性面板 -->
        <div
            class="mt-3 space-y-1.5 rounded-none border p-3 text-xs"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">攻击</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">
                    {stat.atkTotal.toLocaleString()}
                    <span class="text-(--theme-modal-text)/30">
                        ({stat.atkWhite.toLocaleString()} +
                    </span><span class="text-(--theme-accent-text)">{stat.atkGreen.toLocaleString()}</span><span
                        class="text-(--theme-modal-text)/30">)</span
                    >
                </span>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">生命</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">
                    {stat.hpTotal.toLocaleString()}
                    <span class="text-(--theme-modal-text)/30">
                        ({stat.hpWhite.toLocaleString()} +
                    </span><span class="text-(--theme-accent-text)">{stat.hpGreen.toLocaleString()}</span><span
                        class="text-(--theme-modal-text)/30">)</span
                    >
                </span>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">防御</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">
                    {stat.defTotal.toLocaleString()}
                    <span class="text-(--theme-modal-text)/30">
                        ({stat.defWhite.toLocaleString()} +
                    </span><span class="text-(--theme-accent-text)">{stat.defGreen.toLocaleString()}</span><span
                        class="text-(--theme-modal-text)/30">)</span
                    >
                </span>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">谐度破坏增幅</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">{stat.tune}</span>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">共鸣效率</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">{stat.recharge.toFixed(1)}%</span>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-(--theme-modal-text)/50">暴击 / 暴击伤害</span>
                <span class="font-black tabular-nums text-(--theme-modal-text)/80">
                    {stat.critRate.toFixed(1)}% / {stat.critDmg.toFixed(1)}%
                </span>
            </div>
            <!-- 治疗加成（已注释，不进入角色详情配置）
            {#if stat.healBonus > 0}
                <div class="flex items-center justify-between">
                    <span class="text-(--theme-modal-text)/50">治疗加成</span>
                    <span class="font-black tabular-nums text-(--theme-modal-text)/80">+{stat.healBonus}%</span>
                </div>
            {/if}
            -->
            {#if hasBonus}
                <div class="my-2 border-t" style="border-color: var(--theme-divider-border);"></div>
            {/if}
            {#each ELEMENT_ORDER as el}
                {@const v = stat.elementDmg[el]}
                {#if v && v > 0}
                    <div class="flex items-center justify-between">
                        <span class="text-(--theme-modal-text)/50">{el}伤害加成</span>
                        <span class="font-black tabular-nums" style="color: var(--theme-element-{el})">+{v}%</span>
                    </div>
                {/if}
            {/each}
            {#each TYPE_DMG_ORDER as dt}
                {@const type = dt.replace('伤害', '')}
                {@const v = stat.typeDmg[type]}
                {#if v && v > 0}
                    <div class="flex items-center justify-between">
                        <span class="text-(--theme-modal-text)/50">{type}伤害加成</span>
                        <span class="font-black tabular-nums text-(--theme-modal-text)/80">+{v}%</span>
                    </div>
                {/if}
            {/each}
            {#if stat.bonusDmg > 0}
                <div class="flex items-center justify-between">
                    <span class="text-(--theme-modal-text)/50">全属性伤害加成</span>
                    <span class="font-black tabular-nums text-(--theme-accent-text)">+{stat.bonusDmg}%</span>
                </div>
            {/if}
        </div>
    {/if}
</Modal>
