/**
 * @desc `run_js` 的沙箱 Worker。
 *
 * ## 安全模型（本文件存在的全部理由）
 * 同 realm 的 `new Function('window', body)` **不是**沙箱：
 * `(function(){}).constructor('return globalThis')()` 就能拿回真全局，而页面内存里有解密后的 API Key。
 * 所以这里不靠「伪造参数」防护，而是**把逃逸的目标本身掏空**：
 * Worker 本就没有 DOM、没有页面内存、拿不到 API Key；在执行模型代码**之前**再把
 * `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `importScripts` / `indexedDB` / `caches` /
 * `postMessage` / `addEventListener` 等宿主能力**删除**，并把其中删不掉的（`navigator` / `location`
 * 这类只读 getter）用**形参遮蔽**成 `undefined`。于是即便脚本逃到 Worker 真全局，那里也什么都没有。
 *
 * `indexedDB` 是这里最要紧的一条：应用的 AI 配置（含 API Key）存在同源 IndexedDB 里，
 * 而解密用的 AES 密钥由源码里的常量派生 —— 不删它，脚本就能把 Key 读出来解密。
 *
 * ## 工具调用怎么走
 * 脚本调工具 → 本 Worker postMessage 回页面 → 页面用**真正的 `executeTool`** 执行（危险工具照样
 * 弹确认、`requires` 能力校验照样生效）→ 结果 postMessage 回来。脚本**绕不过**权限确认。
 *
 * ## 残余风险（已知并接受）
 * 动态 `import()` 是语法而不是全局属性，删不掉；但它加载的模块也运行在这个**已被掏空**的 realm 里，
 * 同样没有网络与存储，故不构成越权。
 */
import {
    RUN_JS_MAX_ERROR_CHARS,
    RUN_JS_MAX_LOG_CHARS,
    RUN_JS_MAX_LOGS,
    RUN_JS_MAX_OUTPUT_CHARS,
    RUN_JS_MAX_TOOL_CALLS,
    type HostToSandbox,
    type RunScriptPayload,
    type SandboxToHost
} from './protocol'
import {
    SHADOWED_HOST_NAMES,
    buildScriptBody,
    formatLogLine,
    isInjectableToolName,
    safeStringify,
    toSerializable,
    truncateText
} from './format'

type LooseScope = Record<string, unknown> & {
    postMessage: (message: SandboxToHost) => void
    addEventListener: (type: string, listener: (event: MessageEvent<HostToSandbox>) => void) => void
}

const scope = globalThis as unknown as LooseScope

/*
 * 收发通道必须在 `stripCapabilities()` **之前**抓成自由函数。
 *
 * 为什么：strip 会把 `postMessage` / `addEventListener` 从全局删掉，而 `delete` 在这些
 * `[Global]` 接口成员上**确实是生效的**（上一版漏了这一步，实测症状就是脚本跑完回传结果时
 * 报 `scope.postMessage is not a function`，整次执行只能等宿主超时）。
 *
 * 监听器同理：先用捕获到的 `addEventListener` 注册好，之后删掉全局方法**不会**注销已注册的监听器，
 * 但脚本从此再也注册不了自己的监听器、也无法用 `removeEventListener` 拆掉我们的。
 */
const rawPost = scope.postMessage.bind(scope)
const rawAddEventListener = scope.addEventListener.bind(scope)
const hostPost = (message: SandboxToHost): void => rawPost(message)

/** @desc 是否已掏空能力（只掏一次：把「掏空」与「首个 run 消息」绑死） */
let stripped = false

/** @desc 待回填的工具调用（callId → resolve） */
const pendingCalls = new Map<number, (raw: string) => void>()
let nextCallId = 1
let toolCallCount = 0
const logs: string[] = []

/**
 * @desc 摘掉 Worker 里的一切宿主能力。**必须在跑模型代码之前调用，且只调一次。**
 *
 * 只删「能伸到外面去」的能力：网络、存储、与宿主通信、再开 Worker、生命周期。
 * 刻意**保留** `Math` / `JSON` / `Date` / `setTimeout` / `crypto` / `atob` 这类纯计算设施 ——
 * 它们伸不出这个 realm，删了只会让沙箱算不了东西（本工具的主要用途就是计算）。
 */
const stripCapabilities = (): void => {
    const removed = [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'importScripts',
        'indexedDB',
        'caches',
        'postMessage',
        'onmessage',
        'onmessageerror',
        'addEventListener',
        'removeEventListener',
        'close',
        'Worker',
        'SharedWorker',
        'BroadcastChannel',
        'MessageChannel',
        'navigator',
        'location'
    ]
    for (const name of removed) {
        try {
            delete scope[name]
        } catch {
            /* 只读 getter 删不掉：由 SHADOWED_HOST_NAMES 的形参遮蔽兜底 */
        }
    }
}

/** @desc 日志正文总预算（条数之外再按字符数兜底；超出部分截断并标记，不让日志撑爆最终输出） */
let logChars = 0

const pushLog = (text: string): void => {
    if (logs.length >= RUN_JS_MAX_LOGS || logChars >= RUN_JS_MAX_LOG_CHARS) return
    const room = RUN_JS_MAX_LOG_CHARS - logChars
    const clipped = text.length > room ? `${text.slice(0, room)}…[日志已截断]` : text
    logs.push(clipped)
    logChars += clipped.length
}

const formatArgs = (args: readonly unknown[]): string => args.map(formatLogLine).join(' ')

/** @desc 沙箱里的 console：只收集日志，不碰真 console（真 console 属于宿主侧） */
const fakeConsole = {
    log: (...args: unknown[]) => pushLog(formatArgs(args)),
    info: (...args: unknown[]) => pushLog(formatArgs(args)),
    warn: (...args: unknown[]) => pushLog(`[warn] ${formatArgs(args)}`),
    error: (...args: unknown[]) => pushLog(`[error] ${formatArgs(args)}`),
    debug: (...args: unknown[]) => pushLog(formatArgs(args))
}

/** @desc 把一次工具调用桥回宿主，并解包成脚本能直接用的值（失败即 throw，与普通 await 体验一致） */
const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (toolCallCount >= RUN_JS_MAX_TOOL_CALLS) {
        throw new Error(`工具调用次数已达上限（${RUN_JS_MAX_TOOL_CALLS}），拒绝继续调用`)
    }
    toolCallCount += 1
    const callId = nextCallId
    nextCallId += 1
    const raw = await new Promise<string>((resolve) => {
        pendingCalls.set(callId, resolve)
        hostPost({ type: 'tool-call', callId, name, args })
    })
    let parsed: { ok?: boolean; data?: unknown; error?: string; cancelled?: boolean }
    try {
        parsed = JSON.parse(raw) as typeof parsed
    } catch {
        throw new Error(`工具 ${name} 返回了非 JSON 内容`)
    }
    if (parsed?.ok === false) {
        throw new Error(parsed.cancelled ? `工具 ${name} 被用户取消` : (parsed.error ?? `工具 ${name} 执行失败`))
    }
    return parsed?.data ?? null
}

/**
 * @desc 真实 Worker 全局对象。脚本里的 `globalThis.xxx = …` 会写到这里，因此**跨调用保留**；
 * 这也让后续脚本里的裸引用（`helper()`）在真正的全局作用域里解析得到，而不是只挂在一个假对象上。
 * 宿主能力已在首个 run 前 `stripCapabilities()` 删除，写函数不会重新获得网络/存储能力。
 */
const globalScope = scope as unknown as Record<string, unknown>

/** @desc 工具命名空间（持久对象；每次执行时更新其中的工具，旧的引用也能看到新工具） */
const namespace: Record<string, unknown> = {}
let facilitiesReady = false

const ensureFacilities = (): void => {
    if (facilitiesReady) return
    facilitiesReady = true
    // `window` / `globalThis` / `self` 作为**形参**注入（不必、也不应改写 Worker 的只读全局属性）；
    // 这里只挂 `tools` / `console`，让 `globalThis.tools.xxx` 这类写法也能工作。
    try {
        globalScope.tools = namespace
        globalScope.console = fakeConsole
    } catch {
        /* 极少数环境里属性只读：裸 `tools`/`console` 形参仍然可用 */
    }
}

/** @desc 每次执行前重置「本次调用」的统计，但**不清** globalThis 上的用户函数/变量 */
const resetRunState = (): void => {
    pendingCalls.clear()
    nextCallId = 1
    toolCallCount = 0
    logs.length = 0
    logChars = 0
}

/** @desc 执行脚本：在持久全局上注入工具 → 跑 → 序列化结果 */
const execute = async (source: string, toolNames: readonly string[]): Promise<RunScriptPayload> => {
    resetRunState()
    ensureFacilities()

    const injectable = toolNames.filter(isInjectableToolName)
    const wrappers: Record<string, (args?: Record<string, unknown>) => Promise<unknown>> = {}
    for (const name of injectable) wrappers[name] = (args) => callTool(name, args ?? {})

    // 刷新 tools 命名空间（持久对象，旧脚本捕获的 tools 引用仍有效）
    for (const key of Object.keys(namespace)) delete namespace[key]
    Object.assign(namespace, wrappers)
    // 也挂到真实全局：这样以后定义的函数即使没把工具名当形参，也能通过全局查找找到它们
    for (const name of injectable) globalScope[name] = wrappers[name]
    try {
        globalScope.tools = namespace
    } catch {
        /* 裸 tools 形参仍可用 */
    }

    // 形参顺序与下面实参顺序必须逐项对应。
    // web_fetch 与其它工具一样按**工具名原样**注入（裸调用 web_fetch({ url, ... }) 即可），
    // 不再另加驼峰别名；它仍走 executeTool / requires 能力门控，不是浏览器的真 fetch。
    const paramNames = ['window', 'globalThis', 'self', 'console', 'tools', ...SHADOWED_HOST_NAMES, ...injectable]
    const paramValues = [
        globalScope,
        globalScope,
        globalScope,
        fakeConsole,
        namespace,
        ...SHADOWED_HOST_NAMES.map(() => undefined),
        ...injectable.map((name) => wrappers[name])
    ]

    try {
        const factory = new Function(...paramNames, buildScriptBody(source)) as (...values: unknown[]) => unknown
        const raw = await factory(...paramValues)
        // 原始返回值**完整**序列化（不按条目/深度截断），只在最终输出这一步按字符上限截断
        const serialized = toSerializable(raw)
        const { text, truncated } = truncateText(safeStringify(serialized), RUN_JS_MAX_OUTPUT_CHARS)
        // 能放下就给结构化值；放不下才退化成截断字符串（不把上下文撑爆）
        return { ok: true, value: truncated ? text : serialized, logs: [...logs], truncated }
    } catch (e) {
        const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        return {
            ok: false,
            error: truncateText(error, RUN_JS_MAX_ERROR_CHARS).text,
            logs: [...logs]
        }
    }
}

/**
 * @desc 宿主消息入口：`tool-result` 回填工具调用、每个 `run` 触发一次执行。
 *
 * 注意这里**不是** `scope.onmessage` —— 那是个可以被 `delete` 掉的全局属性，
 * 掏空之后我们就收不到 `tool-result` 了（脚本里的工具调用会永远挂住直到超时）。
 * 用捕获的 `addEventListener` 注册的监听器活在内部监听器列表里，删全局方法动不到它。
 *
 * 能力**只掏空一次**；之后的 run 复用同一个 Worker，因此 `globalThis` 上定义的用户函数会保留。
 */
const onHostMessage = (event: MessageEvent<HostToSandbox>): void => {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.type === 'tool-result') {
        pendingCalls.get(message.callId)?.(message.raw)
        pendingCalls.delete(message.callId)
        return
    }
    if (message.type !== 'run') return
    if (!stripped) {
        stripped = true
        // 首个 run 前掏空能力；之后复用 Worker，不再重复掏空（否则会误删用户全局设施）
        stripCapabilities()
    }
    void execute(message.source, message.toolNames).then((payload) => hostPost({ type: 'done', payload }))
}

rawAddEventListener('message', onHostMessage)
