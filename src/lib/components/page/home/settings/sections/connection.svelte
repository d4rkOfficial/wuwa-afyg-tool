<script lang="ts">
    /**
     * @desc 设置 → 连接配置（Phase 5.1 第四增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 迁移说明：
     *   - 登录表单与工坊实例输入（`kuroPhone` / `kuroCode` / `kuroLoginBusy` / `kuroLoginInfo` /
     *     `kuroLoginError` / `kuroCountdown` / `newWorkshopUrl`）落在 `settings-ui.svelte.ts`：抽取前它们是
     *     外壳的 `$state`，而 `TabPanel` 的 `{#key active}` 会在切换栏目时重挂载本组件 —— 留在组件里会被重置
     *     （行为变化）。60s 重发倒计时的定时器句柄与起停（`startKuroCountdown`）也随之进 store：
     *     否则卸载后既没人清理、也没法在重挂载时续上原倒计时。
     *   - `kuroSession` / `kuroValid` / `kuroReason` / `kuroBusy` / `kuroActiveRole`、`providerOptions` /
     *     `activeProviderId` / `providerVersions`、`workshopInstances` / `workshopActiveId` 只是各全局 store 的
     *     `$derived` 视图（非自有状态），随本组件留下；`clearKuroMessages` 与各 `handle*` 是本 tab 的展示逻辑。
     *   - 「进入连接配置时加载各上游版本」的 `$effect` + `loadedVersionTab` 仍留外壳：它的触发条件是外壳自己的
     *     `tab`（外壳正是用这个值决定渲染哪个分支），搬进来就变成「本组件已挂载」这第二个判定来源。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getActiveProviderId,
        getProviderOptions,
        getProviderVersions,
        resetActiveProvider,
        setActiveProvider
    } from '$lib/data/provider-prefs.svelte'
    import {
        addWorkshop,
        getActiveWorkshopId,
        getWorkshopInstances,
        removeWorkshop,
        resetWorkshop,
        setActiveWorkshop
    } from '$lib/data/workshop.svelte'
    import {
        getKuroActiveRole,
        getKuroBusy,
        getKuroReason,
        getKuroSession,
        getKuroValid,
        KuroGeetestRequiredError,
        kuroLogout,
        kuroSendSms,
        kuroVerifyLogin,
        refreshKuroSession,
        setKuroRoleId
    } from '$lib/kuro-app/kuro.svelte'
    import { solveGeetest } from '$lib/kuro-app/geetest'
    import {
        getKuroCode,
        getKuroCountdown,
        getKuroLoginBusy,
        getKuroLoginError,
        getKuroLoginInfo,
        getKuroPhone,
        getNewWorkshopUrl,
        setKuroCode,
        setKuroLoginBusy,
        setKuroLoginError,
        setKuroLoginInfo,
        setKuroPhone,
        setNewWorkshopUrl,
        startKuroCountdown
    } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    // ── 库街区（实验性）：登录态管理（接口走应用自身的 /api/kuro-app 服务端路由，无需配置地址）──
    let kuroSession = $derived(getKuroSession())
    let kuroValid = $derived(getKuroValid())
    let kuroReason = $derived(getKuroReason())
    let kuroBusy = $derived(getKuroBusy())
    let kuroActiveRole = $derived(getKuroActiveRole())
    /** @desc 内联登录表单（登录窗口已删除，验证码登录直接放在设置里） */
    let kuroPhone = $derived(getKuroPhone())
    let kuroCode = $derived(getKuroCode())
    let kuroLoginBusy = $derived(getKuroLoginBusy())
    let kuroLoginInfo = $derived(getKuroLoginInfo())
    let kuroLoginError = $derived(getKuroLoginError())
    let kuroCountdown = $derived(getKuroCountdown())

    const clearKuroMessages = () => {
        setKuroLoginInfo(null)
        setKuroLoginError(null)
    }

    /** @desc 发验证码：先直接试发，上游要求人机验证时弹极验后带校验数据重发 */
    const handleKuroSendCode = async () => {
        clearKuroMessages()
        setKuroLoginBusy(true)
        const target = kuroPhone.trim()
        try {
            try {
                await kuroSendSms(target)
            } catch (e) {
                if (!(e instanceof KuroGeetestRequiredError)) throw e
                setKuroLoginInfo('需要先完成人机验证…')
                const validate = await solveGeetest(e.captchaId, e.product)
                await kuroSendSms(target, JSON.stringify({ ...validate, captcha_id: e.captchaId }))
            }
            setKuroLoginInfo('验证码已发送，请查看手机短信')
            startKuroCountdown()
        } catch (e) {
            setKuroLoginError(e instanceof Error ? e.message : String(e))
        } finally {
            setKuroLoginBusy(false)
        }
    }

    const handleKuroLogin = async () => {
        clearKuroMessages()
        setKuroLoginBusy(true)
        try {
            await kuroVerifyLogin(kuroPhone.trim(), kuroCode.trim())
            setKuroLoginInfo('登录成功')
            setKuroCode('')
        } catch (e) {
            setKuroLoginError(e instanceof Error ? e.message : String(e))
        } finally {
            setKuroLoginBusy(false)
        }
    }

    /** @desc 检验登录有效性（登录窗口删除后，这是唯一的主动校验入口） */
    const handleKuroCheck = async () => {
        await refreshKuroSession(true)
        if (getKuroValid()) addToast('库街区登录状态有效', 'success')
        else addToast(`库街区登录状态无效：${getKuroReason() ?? '未知原因'}`, 'error')
    }

    const handleKuroLogout = async () => {
        try {
            await kuroLogout()
            addToast('已退出库街区登录', 'success')
        } catch (e) {
            addToast(`退出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
        }
    }

    // ── Workshop settings ──
    let workshopInstances = $derived(getWorkshopInstances())
    let workshopActiveId = $derived(getActiveWorkshopId())
    let newWorkshopUrl = $derived(getNewWorkshopUrl())

    async function handleAddWorkshop() {
        const ok = await addWorkshop(newWorkshopUrl)
        if (ok) {
            addToast('已添加工坊实例', 'success')
            setNewWorkshopUrl('')
        } else {
            addToast('地址无效或已存在', 'error')
        }
    }

    async function handleSwitchWorkshop(id: string) {
        await setActiveWorkshop(id)
        addToast('已切换工坊实例', 'success')
    }

    async function handleRemoveWorkshop(id: string) {
        await removeWorkshop(id)
        addToast('已删除工坊实例', 'info')
    }

    async function handleResetWorkshop() {
        await resetWorkshop()
        addToast('已恢复默认工坊实例', 'success')
    }

    // ── 上游数据源（连接配置） ──
    let providerOptions = $derived(getProviderOptions())
    let activeProviderId = $derived(getActiveProviderId())
    let providerVersions = $derived(getProviderVersions())

    function handleSwitchProvider(id: string) {
        if (!setActiveProvider(id)) {
            addToast('未知的数据源', 'error')
            return
        }
        addToast('已切换数据源，列表/详情缓存将按新源重新加载', 'info')
        // 数据可能随上游不同，清空本地缓存以便重新拉取
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }

    function handleResetProvider() {
        resetActiveProvider()
        addToast('已恢复默认数据源（nanoka）', 'success')
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }
</script>

<!-- Connection settings（左右结构）：左=库街区账号，右=上游数据源 + 工坊/分享源 -->
<div class={mergeClass(['grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8', className])} style={styleProp}>
    <!-- ── 库街区（实验性）：登录态管理；接口由应用自身 /api/kuro-app 服务端路由代发 ── -->
    <div class="order-2 flex flex-col xl:order-1">
        <SectionTitle>
            <Icon icon="mdi:account-key-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            库街区账号
            <span class="rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                >实验性</span
            >
        </SectionTitle>
        <p class="mb-3 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
            登录库街区后，可在「词条集 / 快速词条方案」里把账号下鸣潮角色<b>当前装配的声骸</b
            >同步成词条方案。登录凭据由应用自身的服务端路由持有（httpOnly cookie），浏览器脚本读不到。
        </p>

        <!-- 登录状态 -->
        <div
            class="mt-3 flex flex-wrap items-center gap-2 rounded-none border px-2.5 py-2 text-xs"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <Icon
                icon={kuroSession.loggedIn
                    ? kuroValid === false
                        ? 'mdi:shield-alert-outline'
                        : 'mdi:shield-check-outline'
                    : 'mdi:shield-off-outline'}
                class="size-4 shrink-0 {kuroSession.loggedIn && kuroValid !== false
                    ? 'text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/40'}"
            />
            <span class="font-black text-(--theme-modal-text)">
                {kuroSession.loggedIn ? (kuroSession.account?.userName ?? '已登录') : '未登录'}
            </span>
            {#if kuroSession.loggedIn}
                {#if kuroSession.account?.phone}
                    <span class="text-[10px] text-(--theme-modal-text)/40"
                        >{kuroSession.account.phone.replace(/^(\d{3})\d+(\d{2,4})$/, '$1****$2')}</span
                    >
                {/if}
                <span class="text-[10px] text-(--theme-modal-text)/40">
                    · 绑定角色 {kuroSession.roles.length} 个 · 有效性：{kuroValid === null
                        ? '未校验'
                        : kuroValid
                          ? '有效'
                          : `无效（${kuroReason ?? '未知'}）`}
                </span>
            {/if}
        </div>

        <!-- 未登录：内联验证码登录（原独立登录窗口已删除） -->
        {#if !kuroSession.loggedIn}
            <label class="mt-3 block">
                <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">手机号</span>
                <input
                    type="tel"
                    inputmode="numeric"
                    autocomplete="tel"
                    maxlength="11"
                    placeholder="库街区绑定手机号"
                    value={kuroPhone}
                    oninput={(e) => setKuroPhone((e.target as HTMLInputElement).value)}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </label>
            <div class="mt-2 flex items-end gap-2">
                <label class="min-w-0 flex-1">
                    <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">短信验证码</span>
                    <input
                        type="text"
                        inputmode="numeric"
                        maxlength="8"
                        placeholder="6 位验证码"
                        value={kuroCode}
                        oninput={(e) => setKuroCode((e.target as HTMLInputElement).value)}
                        class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    />
                </label>
                <button
                    onclick={handleKuroSendCode}
                    disabled={kuroLoginBusy || kuroCountdown > 0 || !/^\d{6,15}$/.test(kuroPhone.trim())}
                    class="h-[30px] shrink-0 rounded-none border px-2.5 text-[11px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:cursor-not-allowed disabled:opacity-40"
                    style="border-color: var(--theme-divider-border);"
                >
                    {kuroCountdown > 0 ? `${kuroCountdown}s` : '发送验证码'}
                </button>
            </div>
            <button
                onclick={handleKuroLogin}
                disabled={kuroLoginBusy || !kuroPhone.trim() || !kuroCode.trim()}
                class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-none border px-3 py-2 text-xs font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:cursor-not-allowed disabled:opacity-40"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <Icon
                    icon={kuroLoginBusy ? 'mdi:loading' : 'mdi:login-variant'}
                    class={kuroLoginBusy ? 'size-4 animate-spin' : 'size-4'}
                />
                登录
            </button>
            {#if kuroLoginError}
                <div
                    class="mt-2 rounded-none border px-2.5 py-1.5 text-[10px] text-red-400"
                    style="border-color: rgb(248 113 113 / 0.4);"
                >
                    ✗ {kuroLoginError}
                </div>
            {/if}
            {#if kuroLoginInfo}
                <div class="mt-2 text-[10px] text-(--theme-accent-text)">✓ {kuroLoginInfo}</div>
            {/if}
            <p class="mt-2 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                登录凭据由应用自身的服务端路由持有（httpOnly
                cookie，浏览器脚本读不到）；需要人机验证时会按需加载极验脚本（static.geetest.com）。
            </p>
        {/if}

        <!-- 操作 -->
        <div class="mt-3 flex flex-wrap items-center gap-2">
            {#if kuroSession.loggedIn}
                <button
                    onclick={handleKuroCheck}
                    disabled={kuroBusy}
                    class="flex items-center gap-1 rounded-none border px-2.5 py-1.5 text-xs font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:opacity-40"
                    style="border-color: var(--theme-divider-border);"
                    title="让服务端向上游确认一次 token 是否仍然有效"
                >
                    <Icon
                        icon={kuroBusy ? 'mdi:loading' : 'mdi:shield-refresh-outline'}
                        class={kuroBusy ? 'size-4 animate-spin' : 'size-4'}
                    />
                    检验登录有效性
                </button>
                <button
                    onclick={handleKuroLogout}
                    disabled={kuroBusy}
                    class="flex items-center gap-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-red-400 disabled:opacity-40"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon icon="mdi:logout-variant" class="size-4" />
                    退出登录
                </button>
            {/if}
        </div>

        <!-- 绑定角色：同步时使用选中的这个 -->
        {#if kuroSession.roles.length > 0}
            <div class="mt-4">
                <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">同步使用的绑定角色</span>
                <div class="grid grid-cols-1 gap-2">
                    {#each kuroSession.roles as role (role.roleId)}
                        <div
                            data-press=""
                            class={[
                                'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                                kuroActiveRole?.roleId === role.roleId
                                    ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                    : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                            ].join(' ')}
                            onclick={() => setKuroRoleId(role.roleId)}
                        >
                            <Icon
                                icon={kuroActiveRole?.roleId === role.roleId
                                    ? 'mdi:radiobox-marked'
                                    : 'mdi:radiobox-blank'}
                                class="size-4 shrink-0 text-(--theme-accent-text)"
                            />
                            <span class="min-w-0 flex-1 truncate text-xs font-black text-(--theme-modal-text)"
                                >{role.nickname || role.roleId}</span
                            >
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                >{role.serverName ?? role.serverId}{role.level ? ` · Lv.${role.level}` : ''}</span
                            >
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    <!-- ── 上游数据源 + 工坊/分享源 ── -->
    <div class="order-1 flex flex-col xl:order-2">
        <SectionTitle>
            <Icon icon="mdi:cloud-download-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            上游数据源
        </SectionTitle>
        <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
            选择角色/武器/声骸等数据的来源；切换后列表与详情缓存会按新源重新加载
        </p>
        <div class="grid grid-cols-1 gap-2">
            {#each providerOptions as opt (opt.id)}
                <div
                    data-press=""
                    class={[
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                        opt.id === activeProviderId
                            ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                            : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                    ].join(' ')}
                    onclick={() => handleSwitchProvider(opt.id)}
                    title="点击切换该数据源"
                >
                    <Icon
                        icon={opt.id === activeProviderId ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                        class="size-4 shrink-0 text-(--theme-accent-text)"
                    />
                    <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)">{opt.label}</span>
                    <span
                        class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                        title="最新数据版本"
                    >
                        {providerVersions[opt.id] || opt.id}
                    </span>
                </div>
            {/each}
        </div>
        <div class="mt-3 mb-2">
            <Button
                variant="text"
                size="none"
                bare
                onclick={handleResetProvider}
                backgroundImage="transparent"
                class="gap-1 border border-(--theme-divider-border) px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            >
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </Button>
        </div>

        <div class="my-4 border-t xl:hidden" style="border-color: var(--theme-divider-border);"></div>

        <SectionTitle>
            <Icon icon="mdi:storefront-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            工坊 / 分享源
        </SectionTitle>
        <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
            配置椰果工坊实例；单选使用，可删除或新增，分享与工坊列表将使用当前选中实例
        </p>
        <div class="grid grid-cols-1 gap-2">
            {#each workshopInstances as inst (inst.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    data-press=""
                    class={[
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                        inst.id === workshopActiveId
                            ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                            : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                    ].join(' ')}
                    onclick={() => handleSwitchWorkshop(inst.id)}
                    title="点击选中该实例"
                >
                    <Icon
                        icon={inst.id === workshopActiveId ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                        class="size-4 shrink-0 text-(--theme-accent-text)"
                    />
                    <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)">{inst.url}</span>
                    {#if workshopInstances.length > 1}
                        <Button
                            variant="text"
                            bare
                            pad="p-1"
                            onclick={(e) => {
                                e.stopPropagation()
                                handleRemoveWorkshop(inst.id)
                            }}
                            class="shrink-0 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                            title="删除"
                        >
                            <Icon icon="mdi:close" class="size-3.5" />
                        </Button>
                    {/if}
                </div>
            {/each}
        </div>
        <div class="mt-3 flex gap-2">
            <input
                value={newWorkshopUrl}
                oninput={(e) => setNewWorkshopUrl((e.target as HTMLInputElement).value)}
                onkeydown={(e) => e.key === 'Enter' && handleAddWorkshop()}
                placeholder="https://example.com 工坊地址"
                class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
            <button
                onclick={handleAddWorkshop}
                class="flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:plus" class="size-3.5" />
                添加
            </button>
        </div>
        <div class="mt-3">
            <Button
                variant="text"
                size="none"
                bare
                onclick={handleResetWorkshop}
                backgroundImage="transparent"
                class="gap-1 border border-(--theme-divider-border) px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            >
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </Button>
        </div>
    </div>
</div>
