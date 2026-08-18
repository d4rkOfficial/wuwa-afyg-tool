// ── AI 提供商预设 ───────────────────────────────────────────────────────
// 「助手设置」的提供商快捷预设：新建/编辑配置文件时一键填入服务地址与模型示例。
// 转发代理不再维护域名白名单：任意 https 公网地址可接入，由服务端做防 SSRF 校验。

export interface AiProviderPreset {
    id: string
    label: string
    baseUrl: string
    modelHint: string
    apiKeyLabel: string
    apiKeyHref: string
    /** @desc 使用注意（开通/接入点等前置步骤），命中该提供商时在弹窗内展示 */
    guide?: string
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
    {
        id: 'deepseek',
        label: 'DeepSeek 官方',
        baseUrl: 'https://api.deepseek.com',
        modelHint: 'deepseek-v4-flash',
        apiKeyLabel: 'DeepSeek 开放平台',
        apiKeyHref: 'https://platform.deepseek.com'
    },
    {
        id: 'volcengine-ark',
        label: '火山方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        modelHint: 'doubao-seed-1-6-flash',
        apiKeyLabel: '火山引擎方舟控制台',
        apiKeyHref: 'https://console.volcengine.com/ark',
        guide: '需先在方舟控制台「开通管理」开通对应模型：模型名填开通页展示的完整 ID（含版本日期，如 doubao-seed-1-6-flash-250828），未开通会返回 404；或「在线推理」创建推理接入点后用 ep-xxx 作为模型名。其它地域请改用对应区域地址（如 https://ark.cn-guangzhou.volces.com/api/v3）'
    },
    {
        id: 'moonshot',
        label: 'Kimi（月之暗面）',
        baseUrl: 'https://api.moonshot.cn/v1',
        modelHint: 'kimi-k2-turbo-preview',
        apiKeyLabel: 'Moonshot 开放平台',
        apiKeyHref: 'https://platform.moonshot.cn'
    },
    {
        id: 'zhipu',
        label: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelHint: 'glm-4.5',
        apiKeyLabel: '智谱开放平台',
        apiKeyHref: 'https://open.bigmodel.cn'
    },
    {
        id: 'minimax',
        label: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        modelHint: 'MiniMax-Text-01',
        apiKeyLabel: 'MiniMax 开放平台',
        apiKeyHref: 'https://platform.minimaxi.com'
    },
    {
        id: 'dashscope',
        label: '阿里云百炼',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        modelHint: 'qwen-max',
        apiKeyLabel: '阿里云百炼控制台',
        apiKeyHref: 'https://bailian.console.aliyun.com'
    },
    {
        id: 'qianfan',
        label: '百度千帆',
        baseUrl: 'https://qianfan.baidubce.com/v2',
        modelHint: 'ernie-4.0-turbo-8k',
        apiKeyLabel: '百度智能云千帆',
        apiKeyHref: 'https://console.bce.baidu.com/qianfan',
        guide: '需在百度智能云千帆控制台开通「千帆 v2」并创建应用拿 API Key；v2 为 OpenAI 兼容接口，模型名填开通后可用的模型版本'
    },
    {
        id: 'siliconflow',
        label: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
        modelHint: 'deepseek-ai/DeepSeek-V3',
        apiKeyLabel: '硅基流动控制台',
        apiKeyHref: 'https://cloud.siliconflow.cn'
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelHint: 'deepseek/deepseek-chat',
        apiKeyLabel: 'OpenRouter',
        apiKeyHref: 'https://openrouter.ai/keys'
    },
    {
        id: 'groq',
        label: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelHint: 'llama-3.3-70b-versatile',
        apiKeyLabel: 'Groq Console',
        apiKeyHref: 'https://console.groq.com'
    },
    {
        id: 'stepfun',
        label: '阶跃星辰 StepFun',
        baseUrl: 'https://api.stepfun.com/v1',
        modelHint: 'step-2-16k',
        apiKeyLabel: '阶跃星辰开放平台',
        apiKeyHref: 'https://platform.stepfun.com'
    },
    {
        id: 'xfyun',
        label: '讯飞星火',
        baseUrl: 'https://spark-api-open.xf-yun.com/v1',
        modelHint: 'generalv3.5',
        apiKeyLabel: '讯飞开放平台',
        apiKeyHref: 'https://console.xfyun.cn',
        guide: '需在讯飞开放平台创建「星火」服务并按版本开通（如 V3.5/V4.0），模型名填服务版本标识（generalv3.5 / generalv4.0 等）'
    },
    {
        id: 'opencode',
        label: 'opencode',
        baseUrl: 'https://opencode.ai/zen/v1',
        modelHint: 'deepseek-v4-flash-free',
        apiKeyLabel: 'opencode Workspace',
        apiKeyHref: 'https://opencode.ai/auth'
    },
    {
        id: 'ollama',
        label: 'Ollama 本地',
        baseUrl: 'http://localhost:11434/v1',
        modelHint: 'qwen2.5:7b',
        apiKeyLabel: '本地服务无需 API Key',
        apiKeyHref: '',
        guide: '先在本机启动 ollama serve 并拉取模型（如 ollama pull qwen2.5:7b）；由浏览器直连本地地址，无需 API Key'
    }
]
