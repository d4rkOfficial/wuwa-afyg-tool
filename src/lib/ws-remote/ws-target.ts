// WS 连接目标解析（纯函数，独立成模块）：
// ① 只做字符串 → URL 的判定，没有任何浏览器 / store 依赖，可在 node 侧直接回归
//    （`ws-remote.svelte.ts` 会连带 import 整个 AI 工具注册表，测试里加载不起来）；
// ② hash（`#websocket=`）与「设置-连接配置」的服务地址输入共用**同一份**校验，避免两处口径漂移。

/**
 * @desc 解析用户提供的 WS 目标：`host:port` 自动补全协议（https 页面默认 `wss` 防混合内容拦截）；
 * 完整 `ws(s)://` 原样返回（要求 `://` 后非空，`ws://` 这种半成品不算）；
 * 其余（其它协议、缺端口、端口越界、空串）返回 null。
 */
export const parseWsTarget = (raw: string): string | null => {
    const s = raw.trim()
    if (!s) return null
    if (/^wss?:\/\/\S+$/i.test(s)) return s
    if (/^[\w.-]+:\d{1,5}$/.test(s)) {
        const scheme = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'
        return `${scheme}://${s}`
    }
    return null
}
