/**
 * @desc 附件（图片）到两条协议的 **content parts** 转换（纯逻辑，便于单测）。
 *
 * ## 为什么不改 `ChatMessage.content` 的类型
 * `content` 是 `string`，被 token 估算、Markdown 渲染、工具结果、变化队列等多处按字符串消费。
 * 把它改成 `string | ContentPart[]` 会把这些消费点全部拖下水（且大多数与图片无关）。
 * 故内部一律用 `ChatMessage.images?: string[]`（data URL 数组）承载附件，
 * **只在发请求这一刻**转成协议要求的 parts —— 转换集中在本文件，两个调用点：
 * `client.ts`（Chat Completions）与 `session.ts` 的 `toResponseItems`（Responses API）。
 *
 * ## 两条协议的形状差异
 * - Chat Completions：`{ type: 'text', text }` / `{ type: 'image_url', image_url: { url } }`
 * - Responses API：`{ type: 'input_text', text }` / `{ type: 'input_image', image_url }`（**字符串**，不是对象）
 * 这两处形状写错的症状都是服务商 400，故用单测把它们钉住。
 */

/** @desc 图片附件（data URL，形如 `data:image/png;base64,...`） */
export type ImageDataUrl = string

/** @desc OpenAI 兼容的 content part */
export interface ChatContentPart {
    type: 'text' | 'image_url'
    text?: string
    image_url?: { url: string }
}

/** @desc Responses API 的 input content part */
export interface ResponseContentPart {
    type: 'input_text' | 'input_image'
    text?: string
    image_url?: string
}

/**
 * @desc 组装 Chat Completions 的 content parts。
 * 正文为空时**不产生 text part**：部分服务商对空 `text` 会报错或拒绝整条消息。
 */
export const toChatContentParts = (text: string, images: readonly string[]): ChatContentPart[] => [
    ...(text.trim() ? [{ type: 'text' as const, text }] : []),
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
]

/**
 * @desc 组装 Responses API 的 input content parts。
 * 同上：正文为空时不产生 `input_text`，只留图片。
 */
export const toResponseContentParts = (text: string, images: readonly string[]): ResponseContentPart[] => [
    ...(text.trim() ? [{ type: 'input_text' as const, text }] : []),
    ...images.map((url) => ({ type: 'input_image' as const, image_url: url }))
]

/**
 * @desc 消息序列里是否带图片附件（含历史 —— 历史里的图同样要能被模型看到）。
 *
 * 用途：`session.ts` 据此决定走哪条协议。**带图必须改走 Chat Completions**：
 * `image_url`（对象）是各家视觉模型都实现的通用形状，而本应用走 Responses API 只是为了拿
 * DeepSeek 的服务端 `web_search`，`/responses` 对 `input_image` 的支持面窄得多 ——
 * 实测症状是「界面里明明带着图，模型却说自己没收到附件」。
 * 代价：带图的回合没有服务端 `web_search`（可用本地 `web_fetch` 兜底）。
 *
 * 参数用结构化类型（只要 `images` 字段），避免为了一个谓词把 `client.ts` 拉进来。
 */
export const hasImageAttachments = (messages: readonly { images?: string[] }[]): boolean =>
    messages.some((message) => (message.images?.length ?? 0) > 0)
