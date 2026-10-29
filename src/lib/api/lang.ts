// ── 本地 API 的语言参数 ───────────────────────────────────────────────────
// info / list 端点通过 ?lang= 选择上游资源语言，供第三方直接指定语言。
// 语言值不做归一化（原样交给上游），上游不存在该语言时由适配器回退中文；
// 业务侧不传该参数，始终使用默认中文。

/** 默认语言（也是回退语言） */
export const DEFAULT_LANG = 'zh'

/** 从请求 URL 解析 ?lang=；缺失或空白时返回默认中文 */
export const langFromUrl = (url: URL | undefined): string => {
    const raw = url?.searchParams.get('lang')?.trim()
    return raw || DEFAULT_LANG
}
