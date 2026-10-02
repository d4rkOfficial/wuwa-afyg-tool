// ─────────────────────────────────────────────────────────────────────────────
// 【本文件的注释约定 — 改文案/加注释前必读】（与 ask-user.ts 同一套约束）
// scripts/generate-tools-doc.mjs 是「纯正则 + 括号/引号/注释感知」的解析器（不执行 TS）。
// T26 起它会跳过注释与模板串，T28 起取值只在**顶层键**上做、并支持引用本文件的常量，于是：
//   A) 注释里出现反引号 / 裸引号**已不再是问题**（T28 实测：成对/单个反引号、单个/成对单引号、双引号、
//      块注释、乃至参数表内部的这类注释，参数表都照常解析；见 .tmp/reports/T28.md §C.4）。
//   B) `parameters` **仍必须是内联的对象字面量**：写成 `parameters: PARAMETERS`（引用常量）时
//      extractParams 取不到花括号，参数表会变成「_无参数_」。这是解析器不执行 TS 的硬限制。
//   C) 属性级 description 用模板字符串**已支持**（嵌套模板串也对，`${…}` 会被折叠成 `…`）。
// 代价与对策：参数表里的「默认 8000 / 硬顶 40000」等数字是**展示用字面量**，必须与
// web-fetch.utils.ts 的 DEFAULT_MAX_CHARS / HARD_MAX_CHARS 保持一致（改常量时同步改这里）。
// ─────────────────────────────────────────────────────────────────────────────
// 抓取网页工具（web_fetch）：把已知 URL 的网页正文取回来给模型读。
//
// 能力门控（**AI 独享 / ws 禁止调用**的落地方式）：本工具声明 requires: 'webFetch' ——
//   ToolContext.webFetch 只由内置 AI 助手注入（见 $lib/ai/session.ts 的 onWebFetch），
//   WS 远程接管刻意不注入（$lib/ws-remote 的 wsCtx()）。于是 WS 上下文里：
//     ① availableTools() 把它从 hello 的工具清单里滤掉；
//     ② 即便被直接 exec，executeTool() 也会返回明确错误。
//   两道防线都在 registry 里，本文件不重复实现；但 handler 仍会自查一次 ctx.webFetch
//   （handler 也可能被别的路径直接调用）。
//   为什么远程接管要禁：抓取是借用宿主的网络位置发起出网请求，远程通道不该拿它探测内网或取回任意地址。
//
// 入参校验/归一与 HTML→正文提取都是**纯函数**，拆在同目录 web-fetch.utils.ts（AGENTS §1）；
// 真正的出网在宿主侧（经同源代理 /api/ai/fetch，服务端带 SSRF 校验）。
// ─────────────────────────────────────────────────────────────────────────────
import { defineTool } from './registry'
import { normalizeWebFetchArgs } from './web-fetch.utils'

const DESCRIPTION = `抓取一个**已知** http(s) 地址的网页正文（HTML → 纯文本或轻量 Markdown），返回标题、最终地址、HTTP 状态与正文。

怎么用：
- 必须先有确切链接。本工具**不做搜索**（没有搜索引擎能力）：不知道 URL 时先用服务商自带的 web_search，或直接问用户要链接。
- 适合读文档 / 更新日志 / 攻略页 / API 说明的正文；不适合抓需要登录、需要 JS 渲染的页面（拿到的是服务端首屏 HTML，可能缺少动态内容）。
- 自动跟随重定向（最多 5 跳）、剥离脚本/样式/导航/页脚，默认只取正文区域；正文里的链接会按页面地址补成绝对地址。

结果怎么读：
- content 是提取后的正文；truncated=true 表示正文只给到 maxChars 处、**后面还有内容但没有抓取** —— 不要臆造后续，必要时用更精确的 maxChars 或换个更具体的页面再抓一次。
- title 是页面标题（可能缺失）；url 是跟随重定向后的最终地址；status 是 HTTP 状态码。
- 非网页文本（PDF / 图片 / 二进制）不会返回正文，只在 note 里说明；这类内容请直接让用户提供文本。
- 抓取失败（超时 / 目标 4xx-5xx / 内网地址被拦）会返回明确错误，不要重复重试同一个地址。

限制：部署环境下只放行 https 公网地址（内网 / 回环 / 保留地址与云元数据地址由服务端拦截，防 SSRF）；单次抓取超时 15 秒、响应体上限 2MB、正文上限 40000 字符。
能力归属：本工具**仅内置 AI 助手**可用（需要宿主提供抓取能力），WS 远程接管通道无法调用。`

defineTool('web_fetch', {
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '要抓取的 http(s) 链接；缺协议时按 https 补全' },
            format: {
                type: 'string',
                // 取值与 web-fetch.utils.ts 的 WEB_FETCH_FORMATS 保持一致（文档解析器要求内联字面量）
                enum: ['text', 'markdown'],
                description:
                    '正文格式：text=去标签纯文本（默认，省 token）；markdown=保留标题/链接/列表/代码（需要看清页面结构时用）'
            },
            maxChars: {
                type: 'number',
                description: '正文最大字符数（默认 8000，硬顶 40000）；长文档建议先小后大，truncated=true 时再按需追加'
            },
            mainOnly: {
                type: 'boolean',
                description: '只取正文区域并剥离导航/页眉/页脚（默认 true）；false = 连侧栏与页脚一起返回'
            }
        },
        required: ['url'],
        additionalProperties: false
    },
    // T28 起 generate-tools-doc.mjs 只取**顶层** description。这里的 DESCRIPTION 是同文件常量，
    // 解析器会顺着常量找到完整的模板串文案（实测 docs/tools.md 里 web_fetch 的摘要就是下面这段）。
    // 历史上（T26 及以前）它取「块内第一个 description」，所以当时把 parameters 排在最前面来规避；
    // 那段取舍已经不需要了 —— 本字段的位置现在与文档摘要无关。
    description: DESCRIPTION,
    // 能力门控：只有注入了 ToolContext.webFetch 的上下文（内置 AI 助手）能用；WS 远程接管不注入
    requires: 'webFetch',
    handler: async (args, ctx) => {
        // 兜底：正常路径上 executeTool 已按 requires 拦过（返回 ok:false），
        // 但 handler 也可能被别的路径直接调用，故这里再自查一次能力。
        const webFetch = ctx.webFetch
        if (!webFetch) {
            throw new Error(
                '当前上下文不支持抓取网页（缺少宿主能力 webFetch）：该能力由内置 AI 助手提供，WS 远程接管无法调用'
            )
        }
        const request = normalizeWebFetchArgs(args)
        return await webFetch(request)
    }
})
