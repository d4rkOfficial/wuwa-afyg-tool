import { buildKuroPlans, type KuroPlanDraft } from '$lib/kuro-app/kuro-plan'
import { getCharacterList } from '$lib/api/data-cache'
import { saveSubstatPlan } from '$lib/data/substat-library.svelte'
import { getKuroActiveRole, isKuroLoggedIn, kuroFetchRoleEchoes, refreshKuroSession } from '$lib/kuro-app/kuro.svelte'

/** @desc 方案名：同一角色重复同步会覆盖同一份，不堆积（时间与角色记在 note 里） */
export const KURO_PLAN_NAME = '库街区同步'

export interface KuroSyncSkipped {
    character: string
    reason: string
}

/** @desc 同步预览：先算清楚要写什么、跳过什么，交用户确认后再落盘 */
export interface KuroSyncPreview {
    /** @desc 同步来源的绑定角色名 */
    roleName: string
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
 * @desc 只读预览：校验登录 → 取选中角色 → 拉数据 → 映射成方案草稿（不写库）。
 *  这里只按 cookie 读一次会话（不做「检验有效性」，那是设置页的事）；未登录/上游缺接口返回 ok:false + error。
 */
export async function previewSubstatPlansFromKuro(): Promise<{
    ok: boolean
    preview?: KuroSyncPreview
    error?: string
}> {
    try {
        // 先按 httpOnly cookie 拉一次会话：刷新页面后 store 还是空的，直接判「未登录」会误报
        await refreshKuroSession(false)
        if (!isKuroLoggedIn()) throw new Error('尚未登录库街区，请先打开登录窗口完成登录')
        const role = getKuroActiveRole()
        if (!role) throw new Error('该账号下没有已绑定的鸣潮角色（请先在库街区绑定游戏角色）')
        const data = await kuroFetchRoleEchoes(role)
        const { plans, skipped, unmatchedNames } = buildKuroPlans(data.characters, await knownCharacterNames())
        if (plans.length === 0) {
            return {
                ok: false,
                error: `没有可同步的角色（跳过 ${skipped.length} 个）`,
                ...({ preview: { roleName: role.nickname ?? role.roleId, plans, skipped, unmatchedNames } } as const)
            }
        }
        return { ok: true, preview: { roleName: role.nickname ?? role.roleId, plans, skipped, unmatchedNames } }
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
