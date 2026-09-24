import { buildKuroPlans, type KuroPlanDraft } from '$lib/kuro-app/kuro-plan'
import { getCharacterList } from '$lib/api/data-cache'
import { saveSubstatPlan } from '$lib/data/substat-library.svelte'
import { getKuroEchoCache, kuroRefreshCooldownLeft, saveKuroEchoCache } from '$lib/kuro-app/kuro-echo-cache.svelte'
import {
    getKuroActiveRole,
    isKuroLoggedIn,
    kuroFetchRoleEchoes,
    refreshKuroSession,
    type KuroCharacterEchoes
} from '$lib/kuro-app/kuro.svelte'

/** @desc 方案名：同一角色重复同步会覆盖同一份，不堆积（时间与角色记在 note 里） */
export const KURO_PLAN_NAME = '库街区同步'

export interface KuroSyncSkipped {
    character: string
    reason: string
    /** @desc 角色属性（有就按属性归组） */
    element?: string
}

/** @desc 同步预览：先算清楚要写什么、跳过什么，交用户确认后再落盘 */
export interface KuroSyncPreview {
    /** @desc 同步来源的绑定角色名 */
    roleName: string
    /** @desc 上游返回的角色总数（用于解释「一个都没同步到」这类结果） */
    upstreamCount: number
    plans: KuroPlanDraft[]
    skipped: KuroSyncSkipped[]
    unmatchedNames: string[]
}

/** @desc 统一结果口径（UI 弹 toast、AI/WS 工具直接返回，都基于它） */
export interface KuroSyncResult {
    ok: boolean
    synced: number
    roleName?: string
    skipped: KuroSyncSkipped[]
    unmatchedNames: string[]
    error?: string
}

const empty = () => ({ synced: 0, skipped: [], unmatchedNames: [] })

/** @desc 工具箱角色名录（用于把上游角色名对到工具箱写法；取不到就空数组，不影响同步） */
async function knownCharacterNames(): Promise<string[]> {
    try {
        const list = await getCharacterList()
        return list.map((c) => c.name).filter(Boolean)
    } catch {
        return []
    }
}

/**
 * @desc 只读预览：**优先用本地暂存的声骸数据**（有缓存就不请求上游，避免被风控），
 *  没缓存才请求一次并写缓存；`refresh=true` 表示用户手动刷新（受 5 分钟限流）。
 *  未登录/被风控/没有绑定角色都返回 ok:false + error。
 */
export async function previewSubstatPlansFromKuro(opts: { refresh?: boolean } = {}): Promise<{
    ok: boolean
    preview?: KuroSyncPreview
    error?: string
    /** @desc 本次用的数据来自缓存（没有请求上游） */
    fromCache?: boolean
    /** @desc 数据取到的时间戳 */
    fetchedAt?: number
}> {
    try {
        // 会话 store 为空时才去问服务端（例如刚打开页面）；有角色信息就不多打一次上游
        if (!isKuroLoggedIn()) await refreshKuroSession(false)
        if (!isKuroLoggedIn()) throw new Error('尚未登录库街区，请在「设置 → 连接配置 → 库街区账号」登录')
        const role = getKuroActiveRole()
        if (!role) throw new Error('该账号下没有已绑定的鸣潮角色（请先在库街区绑定游戏角色）')

        const cached = getKuroEchoCache(role.roleId)
        let characters: KuroCharacterEchoes[]
        let fetchedAt: number
        let fromCache = false
        if (cached && !opts.refresh) {
            characters = cached.characters
            fetchedAt = cached.fetchedAt
            fromCache = true
        } else {
            if (cached && opts.refresh) {
                const left = kuroRefreshCooldownLeft(role.roleId)
                if (left > 0) {
                    return {
                        ok: false,
                        error: `刷新过于频繁：请等 ${Math.ceil(left / 60000)} 分钟后再刷新（同一份数据 5 分钟只能刷新一次）`
                    }
                }
            }
            const data = await kuroFetchRoleEchoes(role)
            characters = data.characters
            fetchedAt = Date.now()
            saveKuroEchoCache(role.roleId, characters)
        }

        const { plans, skipped, unmatchedNames } = buildKuroPlans(characters, await knownCharacterNames())
        const preview: KuroSyncPreview = {
            roleName: role.nickname ?? role.roleId,
            upstreamCount: characters.length,
            plans,
            skipped,
            unmatchedNames
        }
        if (plans.length === 0) {
            // 空结果最需要原因：把上游返回数量与前几条跳过原因直接写进错误里，免得只看到一句「没有可同步的角色」
            const reasons = skipped
                .slice(0, 3)
                .map((s) => `${s.character}（${s.reason}）`)
                .join('；')
            return {
                ok: false,
                preview,
                fromCache,
                fetchedAt,
                error: `上游返回 ${characters.length} 个角色，一个都没能写成方案${reasons ? `：${reasons}` : ''}${
                    skipped.length > 3 ? ` 等 ${skipped.length} 个` : ''
                }`
            }
        }
        return { ok: true, preview, fromCache, fetchedAt }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}

/** @desc 一条写入选择：upstreamName 定位预览里的角色（角色名可能被用户改成某个形态，如漂泊者的属性） */
export interface KuroPlanPick {
    upstreamName: string
    character: string
}

/** @desc 落盘：把预览里选中的角色写成自定义方案（同名覆盖）
 *  - picks 为空表示「全部写入」（AI/工具链）；给了 picks 就只写列表里的
 *  - 需要指定形态（漂泊者）但没给名字的角色记入 skipped，不静默写成错形态 */
export async function applyKuroSync(
    preview: KuroSyncPreview,
    opts: { planName?: string; picks?: KuroPlanPick[] } = {}
): Promise<KuroSyncResult> {
    const planName = (opts.planName ?? KURO_PLAN_NAME).trim() || KURO_PLAN_NAME
    const picked = opts.picks ? new Map(opts.picks.map((p) => [p.upstreamName, p.character])) : null
    const skipped: KuroSyncSkipped[] = [...preview.skipped]
    const targets: KuroPlanDraft[] = []
    for (const plan of preview.plans) {
        if (picked && !picked.has(plan.upstreamName)) continue
        const character = picked ? (picked.get(plan.upstreamName) ?? '') : plan.options?.length ? '' : plan.character
        if (!character) {
            skipped.push({ character: plan.upstreamName, reason: '需要先指定角色形态（如漂泊者的属性）' })
            continue
        }
        targets.push({ ...plan, character })
    }
    if (targets.length === 0) {
        return {
            ok: false,
            ...empty(),
            roleName: preview.roleName,
            skipped,
            unmatchedNames: preview.unmatchedNames,
            error: '没有勾选任何角色'
        }
    }
    const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
    let synced = 0
    for (const plan of targets) {
        const id = await saveSubstatPlan({
            character: plan.character,
            name: planName,
            slots: plan.slots,
            note: `库街区 · ${preview.roleName} · ${stamp}`
        })
        if (id) synced++
    }
    return {
        ok: synced > 0,
        synced,
        roleName: preview.roleName,
        skipped,
        unmatchedNames: preview.unmatchedNames,
        ...(synced > 0 ? {} : { error: '写入失败：方案数据未通过校验' })
    }
}

/** @desc 一步到位（AI/WS 工具用）：预览 + 全部写入 */
export async function syncSubstatPlansFromKuro(): Promise<KuroSyncResult> {
    const res = await previewSubstatPlansFromKuro()
    if (!res.ok || !res.preview) {
        return {
            ok: false,
            ...empty(),
            skipped: res.preview?.skipped ?? [],
            unmatchedNames: res.preview?.unmatchedNames ?? [],
            roleName: res.preview?.roleName,
            error: res.error ?? '预览失败'
        }
    }
    return applyKuroSync(res.preview, { planName: KURO_PLAN_NAME })
}
