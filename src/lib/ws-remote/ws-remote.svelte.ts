// WS 远程接管客户端：解析 #websocket= 目标 → 连接/自动重连 → 复用 AI 工具注册表（executeTool）执行服务器下发的 exec 指令并回传结果/状态
import { browser, version } from '$app/environment'
import { availableTools, executeTool } from '$lib/ai/tools'
import { runInWindow } from '$lib/ai/sandbox/window-runner'
import { getPanelsState } from '$lib/ai/panels.svelte'
import { getActiveProject, updateCalculation } from '$lib/data/project.svelte'
import { getCalcState, notifyCalcUpdate } from '$lib/calc/calculation.store.svelte'
import { addToast } from '$lib/data/toast.svelte'
import { getWsEnabled, getWsServerUrl, setWsEnabled, setWsServerUrl } from '$lib/data/ws-prefs.svelte'
import { parseWsTarget } from './ws-target'

/** @desc 连接目标解析（纯函数在 `./ws-target`，这里转出以保持「WS 相关都从本模块取」的单一入口） */
export { parseWsTarget }

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'error'

/** @desc 状态图标（顶栏状态按钮与设置-连接配置共用，避免两处各写一份） */
export const WS_ICON: Record<WsStatus, string> = {
    idle: 'mdi:access-point-off',
    connecting: 'mdi:lan-connect',
    connected: 'mdi:access-point',
    error: 'mdi:lan-disconnect'
}

/** @desc 状态文案（同上，两处共用） */
export const WS_LABEL: Record<WsStatus, string> = {
    idle: '未连接',
    connecting: '连接中',
    connected: '已连接',
    error: '连接失败'
}

interface WsHost {
    requestView?: (phase: string) => void
    view?: () => string
}

let _host: WsHost = {}

/** @desc 宿主桥接（+page 注册）：requestView=切视图（同 AI）、view=当前视图名 */
export function setWsHost(host: WsHost): void {
    _host = host
}

let _target = $state('')
let _url = $state('')
let _status = $state<WsStatus>('idle')
let _lastError = $state('')
let _toolCount = $state(0)
let _recentTools = $state<Array<{ tool: string; ok: boolean; time: number }>>([])

let _socket: WebSocket | null = null
let _manualDisconnect = false
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _queue: Array<{ id: string; tool: string; args: Record<string, unknown> }> = []
let _processing = false

/** @desc 解析用户提供的 WS 目标：见 `./ws-target`（纯函数，独立模块以便 node 侧回归） */

function clearReconnectTimer() {
    if (_reconnectTimer !== null) {
        clearTimeout(_reconnectTimer)
        _reconnectTimer = null
    }
}

/** @desc 发起连接（入口）：hash 变化/重连按钮调用 */
export function connectWs(raw: string): void {
    if (!browser) return
    const url = parseWsTarget(raw)
    if (!url) {
        _target = raw
        _url = ''
        _status = 'error'
        _lastError = `无效的 WS 地址：${raw}`
        addToast(`无效的 WS 地址：${raw}`, 'error')
        return
    }
    _target = raw
    _url = url
    _manualDisconnect = false
    openSocket(url)
}

/** @desc 主动断开（hash 移除/组件卸载/下拉按钮），不再自动重连 */
export function disconnectWs(): void {
    _manualDisconnect = true
    clearReconnectTimer()
    if (_socket) {
        try {
            _socket.close()
        } catch {
            /* ignore */
        }
        _socket = null
    }
    _status = 'idle'
    _queue = []
    _processing = false
}

/**
 * @desc 应用「设置-连接配置」的开关 / 地址（该面板的唯一写入口：落盘 + 立即生效）。
 * 开 = 保存地址并连接；关 = 保存地址并断开。
 * 开启时地址非法则**不落盘、不改开关**，返回 `false` 交给调用方提示。
 */
export function setWsConnection(enabled: boolean, rawUrl: string): boolean {
    const raw = rawUrl.trim()
    if (enabled && !parseWsTarget(raw)) return false
    setWsEnabled(enabled)
    setWsServerUrl(raw)
    if (enabled) connectWs(raw)
    else disconnectWs()
    return true
}

/**
 * @desc 启动时按保存的偏好自动连接。宿主在**没有** `#websocket=` hash 时才调用（hash 优先）。
 * 地址缺失 / 非法时静默跳过 —— 偏好里允许停着半成品，不该在启动时弹错。
 */
export function autoConnectWs(): void {
    if (!browser || !getWsEnabled()) return
    const raw = getWsServerUrl()
    if (!raw || !parseWsTarget(raw)) return
    connectWs(raw)
}

function openSocket(url: string): void {
    clearReconnectTimer()
    _status = 'connecting'
    _lastError = ''
    let socket: WebSocket
    try {
        socket = new WebSocket(url)
    } catch (e) {
        _status = 'error'
        _lastError = e instanceof Error ? e.message : String(e)
        addToast(`WS 连接失败：${_lastError}`, 'error')
        return
    }
    _socket = socket

    socket.onopen = () => {
        if (_socket !== socket) return
        _status = 'connected'
        addToast(`已连接 WS 服务器：${_url}`, 'success')
        socket.send(
            JSON.stringify({
                type: 'hello',
                app: 'wuwa-afyg',
                version,
                // 只上报本上下文**真正可用**的工具：需要交互界面或宿主网络能力的（如 ask_user / web_fetch）
                // 在远程接管通道里既不该出现在清单里，直接 exec 也会被 executeTool 的能力校验拒掉
                tools: availableTools(wsCtx()),
                state: buildState(getView())
            })
        )
    }

    socket.onmessage = (ev) => {
        handleMessage(ev.data)
    }

    socket.onerror = () => {
        if (_lastError === '') _lastError = '连接出错'
    }

    socket.onclose = () => {
        if (_socket === socket) _socket = null
        if (_manualDisconnect) {
            _status = 'idle'
            return
        }
        _status = 'error'
        if (_lastError === '') _lastError = '连接已断开'
        addToast(`WS 连接断开（${_url}），3 秒后自动重连`, 'info')
        _reconnectTimer = setTimeout(() => openSocket(url), 3000)
    }
}

// ── 协议处理 ──

function handleMessage(raw: unknown): void {
    let msg: Record<string, unknown>
    try {
        msg = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>)
    } catch {
        return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'ping') {
        _socket?.send(JSON.stringify({ type: 'pong' }))
        return
    }
    if (msg.type === 'exec') {
        const id = String(msg.id ?? crypto.randomUUID())
        const tool = String(msg.tool ?? '')
        const args = msg.args && typeof msg.args === 'object' ? (msg.args as Record<string, unknown>) : {}
        _queue.push({ id, tool, args })
        void drain()
    }
}

/** @desc FIFO 串行执行队列：逐条 executeTool 并回传 result（避免并发改动状态竞争） */
async function drain(): Promise<void> {
    if (_processing || _queue.length === 0) return
    _processing = true
    const job = _queue.shift()!
    try {
        const out = await executeTool(wsCtx(), job.tool, job.args)
        let parsed: Record<string, unknown> = { ok: false, error: '工具返回无法解析' }
        try {
            parsed = JSON.parse(out) as Record<string, unknown>
        } catch {
            parsed = { ok: false, error: out }
        }
        _socket?.send(JSON.stringify({ type: 'result', id: job.id, ...parsed }))
        _toolCount++
        _recentTools = [{ tool: job.tool, ok: parsed.ok === true, time: Date.now() }, ..._recentTools].slice(0, 8)
    } finally {
        _processing = false
        void drain()
    }
}

/** @desc 与 AI 同源的工具执行上下文：危险操作无条件放行；视图/计算态回写走宿主桥。
 *  **刻意不提供 `askUser` 与 `webFetch`** —— 远程接管没有交互界面，也不该借用宿主的网络位置出网抓取，
 *  故需要这两种能力的工具（`ask_user` / `web_fetch`）在此上下文不可用
 *  （`availableTools` 不上清单、`executeTool` 直接拒绝）。 */
function wsCtx() {
    return {
        onConfirm: async () => true,
        requestView: _host.requestView,
        notifyCalc: () => {
            notifyCalcUpdate()
            updateCalculation(getCalcState())
        },
        onGenerateProgress: (text: string) => {
            _socket?.send(JSON.stringify({ type: 'progress', text }))
        },
        // run_js：远程接管走**真 window** 路径（不设沙箱、不注入工具）—— 见 run-js.ts 的说明
        windowRun: runInWindow
    }
}

function getView(): string {
    return _host.view ? _host.view() : ''
}

function buildState(view: string) {
    const p = getActiveProject()
    return {
        project: p ? { id: p.id, name: p.name } : null,
        view,
        locked: p
            ? {
                  team: p.phases.team?.locked === true,
                  timeline: p.phases.timeline?.locked === true,
                  calculation: p.phases.calculation?.locked === true,
                  config: p.phases.config?.locked === true
              }
            : null,
        panels: getPanelsState()
    }
}

/** @desc 推送当前状态快照（工程/视图/锁定/弹窗变化时由宿主调用） */
export function pushState(): void {
    if (_status !== 'connected' || !_socket) return
    _socket.send(JSON.stringify({ type: 'state', state: buildState(getView()) }))
}

// ── 状态读取（模板直接跟踪 $state）──

export function getWsTarget(): string {
    return _target
}
export function getWsUrl(): string {
    return _url
}
export function getWsStatus(): WsStatus {
    return _status
}
export function getWsLastError(): string {
    return _lastError
}
export function getWsToolCount(): number {
    return _toolCount
}
export function getWsRecentTools(): Array<{ tool: string; ok: boolean; time: number }> {
    return _recentTools
}

export { availableTools }
