import { buildKuroPlans } from '$lib/calc/kuro-plan'
import { saveSubstatPlan } from '$lib/data/substat-library.svelte'
import {
    getKuroActiveRole,
    getKuroReason,
    getKuroValid,
    isKuroLoggedIn,
    kuroFetchRoleEchoes,
    refreshKuroSession
} from '$lib/data/kuro.svelte'

/** @desc 库街区同步结果的统一口径（UI 与 AI/WS 工具共用，不带 toast，由调用方决定提示方式） */
export interface KuroSyncResult {
    ok: boolean
    /** @desc 写入/覆盖的方案数（角色数） */
    synced: number
    /** @desc 同步使用的工作室角色名 */
    roleName?: string
    /** @desc 因数据不完整/不合法被跳过的角色 */
    skipped: { character: string; reason: string }[]
    /** @desc 未能识别的上游词条名 */
    unmatchedNames: string[]
    error?: string
}

/** @desc 方案名：同一角色重复同步会覆盖同一份，不堆积（时间与角色记在 note 里） */
export const KURO_PLAN_NAME = '库街区同步'

/**
 * @desc 把库街区账号下鸣潮角色「当前装配的声骸」同步成自定义词条方案（同名覆盖）。
 *  依赖本机代理服务器（.tmp/kuro-server）；未登录/失效/上游缺接口都会返回 ok:false + error。
 */
export async function syncSubstatPlansFromKuro(): Promise<KuroSyncResult> {
    const empty = { synced: 0, skipped: [], unmatchedNames: [] }
    if (!isKuroLoggedIn()) {
        return { ok: false, ...empty, error: '尚未登录库街区，请先打开登录窗口完成登录' }
    }
    try {
        await refreshKuroSession(true)
        if (!getKuroValid()) throw new Error(getKuroReason() ?? '登录已失效，请重新登录')
        const role = getKuroActiveRole()
        if (!role) throw new Error('该账号下没有已绑定的鸣潮角色（请先在库街区绑定游戏角色）')
        const data = await kuroFetchRoleEchoes(role)
        const { plans, skipped, unmatchedNames } = buildKuroPlans(data.characters)
        if (plans.length === 0) {
            return {
                ok: false,
                ...empty,
                roleName: role.nickname,
                skipped,
                unmatchedNames,
                error: `没有可同步的角色（跳过 ${skipped.length} 个）`
            }
        }
        const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
        let synced = 0
        for (const plan of plans) {
            const id = await saveSubstatPlan({
                character: plan.character,
                name: KURO_PLAN_NAME,
                slots: plan.slots,
                note: `库街区 · ${role.nickname ?? role.roleId} · ${stamp}`
            })
            if (id) synced++
        }
        return { ok: true, synced, roleName: role.nickname, skipped, unmatchedNames }
    } catch (e) {
        return { ok: false, ...empty, error: e instanceof Error ? e.message : String(e) }
    }
}
