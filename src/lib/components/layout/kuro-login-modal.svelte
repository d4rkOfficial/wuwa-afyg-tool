<script lang="ts">
    /**
     * @desc 库街区登录窗口（实验性）：短信验证码登录 + 查看绑定角色 + 有效性检验 / 退出登录。
     * 凭据（token）只留在本机代理服务器（.tmp/kuro-server），本窗口只显示登录状态。
     */
    import Icon from '@iconify/svelte'
    import { getModalClosePosition } from '$lib/data/interaction-prefs.svelte'
    import type { ComponentsProps } from '$lib/types'
    import {
        getKuroBase,
        getKuroSession,
        kuroLogout,
        kuroPing,
        kuroSendSms,
        kuroVerifyLogin,
        refreshKuroSession
    } from '$lib/data/kuro.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    let phone = $state('')
    let code = $state('')
    let error = $state<string | null>(null)
    let info = $state<string | null>(null)
    let busy = $state(false)
    let countdown = $state(0)
    let timer: ReturnType<typeof setInterval> | null = null
    /** @desc 代理服务器是否可达：null=检测中 */
    let serverOk = $state<boolean | null>(null)
    let serverMsg = $state('')

    const session = $derived(getKuroSession())

    const maskPhone = (value: string) =>
        value.replace(/^(\d{3})\d+(\d{2,4})$/, (_m, a: string, b: string) => `${a}****${b}`)

    function stopTimer() {
        if (timer) {
            clearInterval(timer)
            timer = null
        }
    }

    function startCountdown() {
        stopTimer()
        countdown = 60
        timer = setInterval(() => {
            countdown -= 1
            if (countdown <= 0) stopTimer()
        }, 1000)
    }

    const clearMessages = () => {
        error = null
        info = null
    }

    /** @desc 打开时：探测代理服务器 + 拉一次会话（不校验，避免无谓请求） */
    $effect(() => {
        if (!open) {
            stopTimer()
            return
        }
        let alive = true
        clearMessages()
        serverOk = null
        void (async () => {
            const ping = await kuroPing()
            if (!alive) return
            serverOk = ping.ok
            serverMsg = ping.ok ? `已连接（v${ping.version ?? '?'}）` : (ping.error ?? '无法连接')
            if (ping.ok) await refreshKuroSession(false)
        })()
        return () => {
            alive = false
        }
    })

    async function handleSend() {
        clearMessages()
        busy = true
        try {
            await kuroSendSms(phone.trim())
            info = '验证码已发送，请查看手机短信'
            startCountdown()
        } catch (e) {
            error = e instanceof Error ? e.message : String(e)
        } finally {
            busy = false
        }
    }

    async function handleLogin() {
        clearMessages()
        busy = true
        try {
            await kuroVerifyLogin(phone.trim(), code.trim())
            info = `登录成功${session.roles.length > 0 ? `，已读取到 ${session.roles.length} 个绑定角色` : ''}`
            code = ''
        } catch (e) {
            error = e instanceof Error ? e.message : String(e)
        } finally {
            busy = false
        }
    }

    async function handleCheck() {
        clearMessages()
        busy = true
        try {
            await refreshKuroSession(true)
            info = '已重新校验登录状态'
        } finally {
            busy = false
        }
    }

    async function handleLogout() {
        clearMessages()
        busy = true
        try {
            await kuroLogout()
            info = '已退出库街区登录'
        } catch (e) {
            error = e instanceof Error ? e.message : String(e)
        } finally {
            busy = false
        }
    }

    function handleRelogin() {
        clearMessages()
        phone = ''
        code = ''
        void handleLogout()
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onclick={onclose}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            data-sf="modal"
            class="animate-pop-in flex max-h-[88vh] w-[min(94vw,26rem)] flex-col overflow-hidden rounded-none border p-4 shadow-2xl {className ??
                ''}"
            style="border-color: var(--theme-divider-border); {styleProp || ''}"
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="mb-3 flex shrink-0 items-center gap-2 border-b pb-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <Icon icon="mdi:account-key-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                <span class="text-sm font-black tracking-tight text-(--theme-modal-text)">库街区登录</span>
                <span
                    class="rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                    >实验性</span
                >
                <button
                    onclick={onclose}
                    class="rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70 {getModalClosePosition() ===
                    'top-left'
                        ? 'order-first'
                        : 'ml-auto'}"
                    aria-label="关闭"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </button>
            </div>

            <div class="theme-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
                <!-- 代理服务器状态 -->
                <div
                    class="flex items-center gap-2 rounded-none border px-2.5 py-2 text-[10px]"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <Icon
                        icon={serverOk === null
                            ? 'mdi:progress-clock'
                            : serverOk
                              ? 'mdi:check-circle-outline'
                              : 'mdi:alert-circle-outline'}
                        class="size-3.5 shrink-0 {serverOk === false ? 'text-red-400' : 'text-(--theme-accent-text)'}"
                    />
                    <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/60">
                        代理服务器 {getKuroBase()} · {serverOk === null ? '检测中…' : serverMsg}
                    </span>
                </div>

                {#if session.loggedIn}
                    <!-- 已登录：展示状态与绑定角色 -->
                    <div class="space-y-2">
                        <div class="flex items-center gap-2 text-xs text-(--theme-modal-text)">
                            <Icon icon="mdi:account-check-outline" class="size-4 text-(--theme-accent-text)" />
                            <span class="font-black">{session.account?.userName ?? '已登录'}</span>
                            {#if session.phone}
                                <span class="text-[10px] text-(--theme-modal-text)/40">{maskPhone(session.phone)}</span>
                            {/if}
                        </div>
                        <div class="text-[10px] text-(--theme-modal-text)/40">绑定的鸣潮角色</div>
                        {#if session.roles.length === 0}
                            <div class="text-[10px] text-(--theme-modal-text)/40">
                                该账号下没有查询到已绑定的鸣潮角色（请先在库街区里绑定游戏角色）
                            </div>
                        {:else}
                            <div class="space-y-1">
                                {#each session.roles as role (role.roleId)}
                                    <div
                                        class="flex items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px]"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="min-w-0 flex-1 truncate font-black text-(--theme-modal-text)"
                                            >{role.nickname || role.roleId}</span
                                        >
                                        <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                            >{role.serverName ?? role.serverId}{role.level
                                                ? ` · Lv.${role.level}`
                                                : ''}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <!-- 未登录：手机号 + 验证码 -->
                    <label class="block">
                        <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">手机号</span>
                        <input
                            type="tel"
                            inputmode="numeric"
                            autocomplete="tel"
                            maxlength="11"
                            placeholder="库街区绑定手机号"
                            bind:value={phone}
                            class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        />
                    </label>
                    <div class="flex items-end gap-2">
                        <label class="min-w-0 flex-1">
                            <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">短信验证码</span>
                            <input
                                type="text"
                                inputmode="numeric"
                                maxlength="8"
                                placeholder="6 位验证码"
                                bind:value={code}
                                class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            />
                        </label>
                        <button
                            onclick={handleSend}
                            disabled={busy || countdown > 0 || !/^\d{6,15}$/.test(phone.trim())}
                            class="h-[30px] shrink-0 rounded-none border px-2.5 text-[11px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:cursor-not-allowed disabled:opacity-40"
                            style="border-color: var(--theme-divider-border);"
                        >
                            {countdown > 0 ? `${countdown}s` : '发送验证码'}
                        </button>
                    </div>
                    <button
                        onclick={handleLogin}
                        disabled={busy || !phone.trim() || !code.trim()}
                        class="flex w-full items-center justify-center gap-1.5 rounded-none border px-3 py-2 text-xs font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:cursor-not-allowed disabled:opacity-40"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <Icon icon="mdi:login-variant" class="size-4" />
                        登录
                    </button>
                {/if}

                {#if error}
                    <div
                        class="rounded-none border px-2.5 py-1.5 text-[10px] text-red-400"
                        style="border-color: rgb(248 113 113 / 0.4);"
                    >
                        ✗ {error}
                    </div>
                {/if}
                {#if info}
                    <div class="text-[10px] text-(--theme-accent-text)">✓ {info}</div>
                {/if}

                <p class="text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    登录凭据仅保存在本机代理服务器（token 不会下发到浏览器）；该功能为实验性，接口变动可能随时失效。
                </p>
            </div>

            {#if session.loggedIn}
                <div
                    class="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t pt-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={handleCheck}
                        disabled={busy}
                        class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-[11px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <Icon icon="mdi:shield-check-outline" class="size-3.5" />
                        检验有效性
                    </button>
                    <button
                        onclick={handleRelogin}
                        disabled={busy}
                        class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-[11px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <Icon icon="mdi:login-variant" class="size-3.5" />
                        重新登录
                    </button>
                    <button
                        onclick={handleLogout}
                        disabled={busy}
                        class="ml-auto flex items-center gap-1 rounded-none border px-2.5 py-1 text-[11px] text-(--theme-modal-text)/60 transition-colors hover:text-red-400 disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <Icon icon="mdi:logout-variant" class="size-3.5" />
                        退出登录
                    </button>
                </div>
            {/if}
        </div>
    </div>
{/if}
