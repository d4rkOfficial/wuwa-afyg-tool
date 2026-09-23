import { browser } from '$app/environment'
import { getCharacterInfo, getEchoInfo } from '$lib/api/data-cache'
import type { CharacterInfo } from '$lib/api/types'

/** @desc 角色数据（含技能文案富文本）轻量缓存：伤害类型推导规则2（「视为/为 XX 伤害」）需要，
 *  界面可同步取用；异步补齐后 $state 变化会让使用它的 $derived 自动重算 */
let _infos = $state<Record<string, CharacterInfo>>({})
const _pending = new Set<string>()

/** @desc 声骸技能文案（首位声骸名 → skill.desc）：声骸技能条目的伤害类型推导规则2 需要 */
let _echoSkillText = $state<Record<string, string>>({})
const _pendingEcho = new Set<string>()

export async function ensureCharInfo(name: string): Promise<void> {
    if (!browser || !name || _infos[name] || _pending.has(name)) return
    _pending.add(name)
    try {
        const info = await getCharacterInfo(name)
        _infos = { ..._infos, [name]: info }
    } catch {
        // 取不到角色数据时静默退回规则1 / 按技能类型推导
    } finally {
        _pending.delete(name)
    }
}

export function getCharInfoMap(): Record<string, CharacterInfo> {
    return _infos
}

export async function ensureEchoSkillText(name: string): Promise<void> {
    if (!browser || !name || _echoSkillText[name] || _pendingEcho.has(name)) return
    _pendingEcho.add(name)
    try {
        const info = await getEchoInfo(name)
        const desc = info?.skill?.desc ?? ''
        if (desc) _echoSkillText = { ..._echoSkillText, [name]: desc }
    } catch {
        // 取不到声骸数据时静默退回规则1 / 按技能类型推导
    } finally {
        _pendingEcho.delete(name)
    }
}

export function getEchoSkillText(): Record<string, string> {
    return _echoSkillText
}

/** @desc 直接注入声骸技能文案映射：Worker 线程里用主线程已解析好的映射初始化它（compute 内部读这个 store
 *  做伤害类型推导），避免 worker 内重复请求上游、也保证两条执行路径结果一致 */
export function setEchoSkillText(map: Record<string, string>): void {
    _echoSkillText = map
}
