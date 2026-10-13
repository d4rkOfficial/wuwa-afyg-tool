/**
 * @desc 图片附件的准入校验与读取。
 *
 * 校验做成**纯函数**（`validateImageFile` / `planAttachments`）是为了可单测：
 * 上限与拒绝文案散在组件里最容易出现「界面说 4 张、实际只收 3 张」这类漂移。
 *
 * 只收图片、不收通用文件：浏览器里没有文件系统可供模型「自己去读」，通用文件要么得引解析库
 * （PDF / docx），要么只能抽纯文本；图片则可以直接以 data URL 走两条协议的图片 part。
 */

/** @desc 单条消息最多几张图 */
export const MAX_ATTACHMENTS = 4

/** @desc 单张图片字节上限（5 MiB）。base64 后约 +33%，再大对请求体与服务商都不友好 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/** @desc 允许的图片类型（与 DSH 的白名单一致） */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** @desc `<input type="file">` 的 accept 属性 */
export const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',')

/** @desc 校验（以及规划）只看这三个字段，故不要求真的 `File` —— 便于单测传入普通对象 */
export interface AttachmentCandidate {
    name: string
    type: string
    size: number
}

/** @desc 字节数展示：`1.5 MB` */
export const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
}

/** @desc 校验结果：`null` = 通过，否则是给用户看的原因 */
export type AttachmentRejection = string | null

/** @desc 单张图片的准入校验 */
export const validateImageFile = (file: AttachmentCandidate): AttachmentRejection => {
    const label = file.name || '文件'
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        return `「${label}」不是支持的图片格式（只收 PNG / JPEG / WebP / GIF）`
    }
    if (file.size === 0) return `「${label}」是空文件`
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return `「${label}」${formatBytes(file.size)} 超过单张上限 ${formatBytes(MAX_ATTACHMENT_BYTES)}`
    }
    return null
}

export interface AttachmentPlan<T extends AttachmentCandidate> {
    /** @desc 通过校验、可以读取的文件（按输入顺序，已按剩余名额截断） */
    accepted: T[]
    /** @desc 被拒绝的原因（逐条给用户看，不静默丢弃） */
    rejections: string[]
}

/**
 * @desc 规划一次「追加附件」：在已有 `existingCount` 张的基础上，逐个校验并受剩余名额限制。
 * @returns 通过的文件与被拒原因。**不静默丢弃**：每一张没收下的都会给出理由。
 * 泛型是为了让调用方拿到原始类型（传 `File[]` 就拿回 `File[]`，不必再断言）。
 */
export const planAttachments = <T extends AttachmentCandidate>(
    existingCount: number,
    files: readonly T[]
): AttachmentPlan<T> => {
    const accepted: T[] = []
    const rejections: string[] = []
    for (const file of files) {
        if (existingCount + accepted.length >= MAX_ATTACHMENTS) {
            rejections.push(`最多 ${MAX_ATTACHMENTS} 张图片，「${file.name || '文件'}」未加入`)
            continue
        }
        const reason = validateImageFile(file)
        if (reason) rejections.push(reason)
        else accepted.push(file)
    }
    return { accepted, rejections }
}

/**
 * @desc 把图片读成 data URL。
 * 用 `FileReader` 的 data-URL 路径（浏览器原生，不需要 canvas 重编码）；
 * 失败时 reject 一个带可读原因的错误，由调用方转成 toast。
 */
export const readImageAsDataUrl = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result
            if (typeof result === 'string' && result.startsWith('data:')) resolve(result)
            else reject(new Error('读取图片失败：结果不是 data URL'))
        }
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
    })
