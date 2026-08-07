// 角色术语提取（移植自 wuwa-afyg-share src/lib/ai/terms.ts，逻辑源于本工具 rich-text 提取规则）
export interface TermItem {
    id: string | null
    text: string
}

export interface CharacterTerms {
    entityName: string
    // 【】内的效果名，如 冰棱/灼羽/离火
    effects: string[]
    // <color=Highlight> 触发关键词，如 第5段普攻/爆裂
    highlights: string[]
    // <te href=N> 术语链接
    terms: TermItem[]
    // 每条技能/命座/固有去标签后的纯文本短描述（压缩空白）
    entries: Array<{ name: string; text: string }>
}

function stripTags(text: string): string {
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

export function extractTerms(text: string): { highlights: string[]; terms: TermItem[] } {
    const highlights: string[] = []
    const terms: TermItem[] = []
    const seen = new Set<string>()

    const teRe = /<te\s+href=(\d+)>([^<]*)<\/te>/gi
    let m: RegExpExecArray | null
    while ((m = teRe.exec(text)) !== null) {
        const term = m[2].trim()
        if (term && !seen.has(term)) {
            seen.add(term)
            terms.push({ id: m[1], text: term })
        }
    }

    const noTe = text.replace(/<te\s+href=\d+>[^<]*<\/te>/gi, '')
    const hlRe = /<color=Highlight>([^<]+)<\/color>/gi
    while ((m = hlRe.exec(noTe)) !== null) {
        const term = m[1].trim()
        if (term && !seen.has(term)) {
            seen.add(term)
            highlights.push(term)
        }
    }

    return { highlights, terms }
}

export function analyzeCharacterTerms(entityName: string, info: unknown): CharacterTerms {
    const effects: string[] = []
    const highlights: string[] = []
    const terms: TermItem[] = []
    const entries: Array<{ name: string; text: string }> = []
    const effSeen = new Set<string>()
    const hlSeen = new Set<string>()
    const termSeen = new Set<string>()

    function pushEffects(text: string) {
        const re = /【([^】]+)】/g
        let mm: RegExpExecArray | null
        while ((mm = re.exec(text)) !== null) {
            const name = mm[1].trim()
            if (name && !effSeen.has(name)) {
                effSeen.add(name)
                effects.push(name)
            }
        }
    }

    function mergeFromDesc(desc: string) {
        if (!desc) return
        pushEffects(desc)
        const { highlights: h, terms: t } = extractTerms(desc)
        for (const x of h) {
            if (!hlSeen.has(x)) {
                hlSeen.add(x)
                highlights.push(x)
            }
        }
        for (const x of t) {
            if (!termSeen.has(x.text)) {
                termSeen.add(x.text)
                terms.push(x)
            }
        }
    }

    function addEntry(name: string, desc: string) {
        if (!name || !desc) return
        mergeFromDesc(desc)
        entries.push({ name, text: stripTags(desc) })
    }

    if (info && typeof info === 'object') {
        const o = info as Record<string, unknown>
        for (const skill of Array.isArray(o.skills) ? (o.skills as Array<Record<string, unknown>>) : []) {
            addEntry(String(skill.name ?? ''), String(skill.desc ?? ''))
        }
        for (const node of Array.isArray(o.statNodes) ? (o.statNodes as Array<Record<string, unknown>>) : []) {
            addEntry(String(node.name ?? ''), String(node.desc ?? ''))
        }
        for (const chain of Array.isArray(o.chains) ? (o.chains as Array<Record<string, unknown>>) : []) {
            addEntry(String(chain.name ?? ''), String(chain.desc ?? ''))
        }
    }

    return { entityName, effects, highlights, terms, entries }
}
