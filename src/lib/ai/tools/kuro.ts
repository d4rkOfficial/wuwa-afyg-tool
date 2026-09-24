/**
 * @desc 库街区（实验性）与词条集同步相关的 AI/WS 工具：
 *  登录态/暂存查询、有效性校验、声骸数据强制刷新、打开同步预览弹窗、退出登录。
 *  取数走本地暂存优先的策略（有缓存不打上游、刷新 5 分钟限流），工具保持同一口径。
 */
import { defineTool } from '$lib/ai/tools/registry'
import {
    getKuroActiveRole,
    getKuroReason,
    getKuroSession,
    getKuroValid,
    kuroLogout,
    refreshKuroSession
} from '$lib/kuro-app/kuro.svelte'
import { getKuroEchoCacheEntry, kuroRefreshCooldownLeft } from '$lib/kuro-app/kuro-echo-cache.svelte'
import { previewSubstatPlansFromKuro } from '$lib/kuro-app/kuro-sync.svelte'
import { openPanel } from '$lib/ai/panels.svelte'
import { requestKuroSyncPreview } from '$lib/data/substat-library-ui.svelte'

defineTool('get_kuro_state', {
    description:
        '查看库街区登录态与声骸数据暂存：是否登录、账号、绑定角色、登录有效性、本地暂存的数据时间与可刷新倒计时。' +
        '判断「要不要刷新数据」「是否还登录着」时先调它。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const role = getKuroActiveRole()
        const session = getKuroSession()
        const cache = getKuroEchoCacheEntry()
        return {
            loggedIn: session.loggedIn,
            account: session.account,
            valid: getKuroValid(),
            reason: getKuroReason(),
            roles: session.roles.map((r) => ({ roleId: r.roleId, nickname: r.nickname ?? null })),
            activeRole: role ? { roleId: role.roleId, nickname: role.nickname ?? null, serverId: role.serverId } : null,
            echoCache: cache
                ? {
                      roleId: cache.roleId,
                      fetchedAt: new Date(cache.fetchedAt).toLocaleString('zh-CN', { hour12: false }),
                      characters: cache.characters.length,
                      cooldownSecondsLeft: Math.ceil(kuroRefreshCooldownLeft(cache.roleId) / 1000)
                  }
                : null
        }
    }
})

defineTool('check_kuro_login', {
    description:
        '让服务端向上游确认一次库街区登录是否仍有效（即设置里的「检验登录有效性」），返回有效性、原因、账号与绑定角色。' +
        '同步报登录相关错误时用它确认。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        await refreshKuroSession(true)
        const session = getKuroSession()
        return {
            loggedIn: session.loggedIn,
            valid: getKuroValid(),
            reason: getKuroReason(),
            account: session.account,
            roles: session.roles.map((r) => ({ roleId: r.roleId, nickname: r.nickname ?? null }))
        }
    }
})

defineTool('refresh_kuro_echo_data', {
    description:
        '强制从库街区重新拉取当前绑定角色的声骸数据并写入本地暂存（同一份数据 5 分钟只能刷新一次，冷却期内会报错）。' +
        '平时同步直接用本地暂存、不打上游；只有用户明确要「最新数据」时才调用。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const res = await previewSubstatPlansFromKuro({ refresh: true })
        if (!res.ok) throw new Error(res.error ?? '刷新失败')
        return {
            role: res.preview?.roleName ?? null,
            characters: res.preview?.upstreamCount ?? 0,
            plans: res.preview?.plans.length ?? 0,
            fetchedAt: res.fetchedAt ? new Date(res.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : null
        }
    }
})

defineTool('open_kuro_sync_preview', {
    description:
        '打开「词条集 → 从库街区同步」预览弹窗（会先打开词条集面板，然后载入当前暂存/上游数据），' +
        '由用户在卡片列表里勾选要写入的角色。需要用户自己挑角色或改方案名时用它，而不是直接写入。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        openPanel('substat-library', true)
        if (!requestKuroSyncPreview()) throw new Error('词条集面板打开失败，无法显示同步预览')
        return { opened: true, hint: '请在弹窗里勾选要写入的角色后点「写入 N 个方案」' }
    }
})

defineTool('kuro_logout', {
    description: '退出库街区登录（同时清除本地声骸数据暂存）。用户要求退出或换账号时使用。',
    parameters: { type: 'object', properties: {} },
    dangerous: true,
    handler: async () => {
        await kuroLogout()
        return { loggedOut: true }
    }
})
