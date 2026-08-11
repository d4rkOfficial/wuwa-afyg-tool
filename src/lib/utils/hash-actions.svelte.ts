// 统一 hash 动作管理：注册表 + 解析/分发/清理/监听单一入口（reset-cache / websocket / import_project 等）
import { browser } from '$app/environment'

export interface HashParam {
    key: string
    value: string
}

export interface HashAction {
    /** 匹配的 hash key（如 'websocket'、'import_project'） */
    key: string
    /** 匹配到且未执行过时调用（once 动作执行后自动清 hash 并注销） */
    run: (value: string) => void | Promise<void>
    /** key 从 hash 中消失时调用（如 websocket 断开） */
    cleanup?: () => void
    /** 一次性动作：run 后自动清 hash 并注销（import_project） */
    once?: boolean
}

const actions = new Map<string, HashAction>()
const ran = new Set<string>()
let listenerInstalled = false

/** @desc 解析 URL hash 参数：#k1=v1&k2=v2 → [{key,value}]；空 hash 返回 []（纯函数） */
export function parseHashParams(hash: string): HashParam[] {
    const body = hash.startsWith('#') ? hash.slice(1) : hash
    if (!body) return []
    return body
        .split('&')
        .map((pair) => {
            const eq = pair.indexOf('=')
            if (eq < 0) return { key: pair, value: '' }
            return { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
        })
        .filter((p) => p.key.length > 0)
        .map((p) => ({ key: p.key, value: decodeURIComponent(p.value) }))
}

export function registerHashAction(action: HashAction): void {
    actions.set(action.key, action)
    ran.delete(action.key)
}

export function unregisterHashAction(key: string): void {
    actions.delete(key)
    ran.delete(key)
}

/** @desc 从当前 hash 中移除指定 key（保留其它参数；once 动作执行完毕后调用） */
function removeHashParam(key: string): void {
    if (!browser) return
    const params = parseHashParams(globalThis.location.hash).filter((p) => p.key !== key)
    const next =
        params.length > 0
            ? '#' + params.map((p) => p.key + (p.value ? '=' + encodeURIComponent(p.value) : '')).join('&')
            : ''
    globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search + next)
}

/** @desc 按当前 hash 分发：新出现的 key → run（once 动作完成后移除自身 hash 参数并注销）；消失的 key → cleanup */
export async function runHashActions(): Promise<void> {
    if (!browser) return
    const params = parseHashParams(globalThis.location.hash)
    const present = new Set(params.map((p) => p.key))

    for (const key of actions.keys()) {
        if (!present.has(key) && ran.has(key)) {
            const action = actions.get(key)
            if (action?.cleanup) await action.cleanup()
            ran.delete(key)
        }
    }

    for (const p of params) {
        const action = actions.get(p.key)
        if (!action || ran.has(p.key)) continue
        ran.add(p.key)
        await action.run(p.value)
        if (action.once) {
            removeHashParam(p.key)
            actions.delete(p.key)
        }
    }
}

/** @desc 挂载统一 hashchange 监听（+layout onMount 调用一次）；返回卸载函数 */
export function initHashActions(): () => void {
    if (listenerInstalled) return () => {}
    listenerInstalled = true
    const onChange = () => {
        void runHashActions()
    }
    globalThis.addEventListener('hashchange', onChange)
    return () => {
        listenerInstalled = false
        globalThis.removeEventListener('hashchange', onChange)
    }
}
