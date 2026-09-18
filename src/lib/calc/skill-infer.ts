import type { CharacterInfo } from '$lib/api/types'
import type { DamageEntry } from './calculation.types'
import type { CharSlot } from '$lib/types/project'

/**
 * @desc 规则1：技能倍率名里的类型前缀 → 对应伤害类型
 * 空中攻击 / 闪避反击本身属于普攻体系，默认按普攻伤害结算；文案明确写「为重击伤害」的由规则2覆盖。
 */
const NAME_PREFIX_TYPES: Array<[string, string]> = [
    ['普攻·', '普攻伤害'],
    ['重击·', '重击伤害'],
    ['空中攻击', '普攻伤害'],
    ['闪避反击', '普攻伤害'],
    ['共鸣技能·', '共鸣技能伤害'],
    ['共鸣解放·', '共鸣解放伤害'],
    ['变奏技能·', '变奏技能伤害'],
    ['延奏技能·', '延奏技能伤害']
]

/** @desc 规则2：「视为/视作/算作/计为/为 XX 伤害」里的伤害名（含「XX效应」通配） */
const VIEW_AS_SOURCE =
    '(视为|视作|算作|计为|为)((?:[^，。；、！？,.\\s]{1,4}效应)|普攻|重击|共鸣技能|共鸣解放|声骸技能|变奏技能|延奏技能|协同攻击)伤害'

/** @desc 句界：只用句号/分号/换行；感叹号与问号可能出现在技能名内（如「大嘭嘭！」），不能当句界 */
const SENTENCE_SEPARATORS = /[。；;\n]/
const CLAUSE_SEPARATORS = /[。；;，,、！!？?\n]/

const CN_DIGITS: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
}

/** @desc 去标签纯文本：先剥标签（`<te href=1>共鸣技能</te>` 会把词拆开），再压缩空白 */
export function stripRichTags(text: string): string {
    return String(text ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, '')
}

function cnToNumber(token: string): number | null {
    if (token === '十') return 10
    if (token.startsWith('十')) {
        const rest = CN_DIGITS[token.slice(1)]
        return rest ? 10 + rest : null
    }
    if (token.endsWith('十')) {
        const head = CN_DIGITS[token.slice(0, 1)]
        return head ? head * 10 : null
    }
    if (token.length === 1) return CN_DIGITS[token] ?? null
    return null
}

/** @desc 段号统一成阿拉伯数字（游戏文案写「普攻第一段」、命中名写「普攻第1段」） */
export function normalizeNumerals(text: string): string {
    return String(text ?? '').replace(/第([一二三四五六七八九十]{1,3})段/g, (whole, cn: string) => {
        const n = cnToNumber(cn)
        return n ? `第${n}段` : whole
    })
}

function typeWordToDamageType(word: string): string {
    if (word === '协同攻击') return '协同攻击伤害'
    if (word.endsWith('效应')) return '效应伤害'
    return `${word}伤害`
}

interface Phrase {
    type: string
    index: number
    sentenceStart: number
    sentenceEnd: number
    clause: string
}

function boundsAt(text: string, index: number, separators: RegExp): [number, number] {
    let start = index
    while (start > 0 && !separators.test(text[start - 1]!)) start--
    let end = index
    while (end < text.length && !separators.test(text[end]!)) end++
    return [start, end]
}

/** @desc 收集文案里全部「XX 伤害为/视为 YY 伤害」（带句/子句范围；排除「不作为/非/勿」等否定写法） */
function collectPhrases(plain: string): Phrase[] {
    const re = new RegExp(VIEW_AS_SOURCE, 'g')
    const out: Phrase[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(plain)) !== null) {
        // 否定写法：「不作为/不算作/不计为/不视为/非为/勿为」整段跳过
        const head = plain.slice(Math.max(0, m.index - 3), m.index + 1)
        if (/(不[作算视计]?为|非为|勿为|未为|不为)$/.test(head)) continue
        const [sentenceStart, sentenceEnd] = boundsAt(plain, m.index, SENTENCE_SEPARATORS)
        const [clauseStart, clauseEnd] = boundsAt(plain, m.index, CLAUSE_SEPARATORS)
        out.push({
            type: typeWordToDamageType(m[2]),
            index: m.index,
            sentenceStart,
            sentenceEnd,
            clause: plain.slice(clauseStart, clauseEnd)
        })
    }
    return out
}

// 「技能伤害」必须排在「伤害」之前：先去掉长后缀，才能把「诗中物技能伤害」还原成「诗中物」
const SIBLING_SUFFIXES = [
    '技能伤害',
    '耐力消耗（每秒）',
    '耐力消耗',
    '冷却时间',
    '回复协奏能量',
    '消耗共鸣能量',
    '伤害'
]

/** @desc 倍率行名 → 技能标识（去掉「伤害/冷却时间/耐力消耗」等后缀并统一段号数字） */
function siblingToken(rowName: string): string {
    let name = normalizeNumerals(stripRichTags(rowName))
    let changed = true
    while (changed) {
        changed = false
        for (const suffix of SIBLING_SUFFIXES) {
            if (name.endsWith(suffix) && name.length > suffix.length) {
                name = name.slice(0, -suffix.length)
                changed = true
            }
        }
    }
    return name
}

interface NeedleGroups {
    /** @desc 含技能名的关键词（最具体，优先使用） */
    byName: string[]
    /** @desc 仅段号的关键词（次优先） */
    bySegment: string[]
}

/** @desc 裸动作词：作为关键词过于宽泛，会被别的小节「认领」 */
const GENERIC_ACTION_WORDS = ['普攻', '重击', '空中攻击', '闪避反击', '共鸣技能', '共鸣解放', '变奏技能', '延奏技能']

/** @desc 由命中名推导定位关键词：优先「技能名」粒度，其次「段号」粒度 */
function needlesForHit(hitName: string, skillType?: string): NeedleGroups {
    const byName: string[] = []
    const bySegment: string[] = []
    const pushName = (value: string) => {
        const t = value.trim()
        if (t.length >= 2 && !byName.includes(t)) byName.push(t)
    }
    const pushSegment = (value: string) => {
        const t = value.trim()
        if (t.length >= 2 && !bySegment.includes(t)) bySegment.push(t)
    }
    const name = normalizeNumerals(hitName)
    pushName(name)
    if (skillType && name.startsWith(skillType)) pushName(name.slice(skillType.length))
    pushName(siblingToken(name))
    const seg = /第(\d+)段/.exec(name)
    if (seg) {
        pushSegment(`第${seg[1]}段`)
        pushSegment(`第${seg[1]}`)
        // 「重击·燧发杀戮第一段」→ 技能名前缀「重击·燧发杀戮」；裸动作词（普攻/重击）太泛，会误命中别的小节，不作为关键词
        const prefix = name.slice(0, seg.index)
        if (prefix.includes('·') || prefix.length >= 4) pushName(prefix)
    }
    const dot = name.indexOf('·')
    if (dot >= 0) {
        pushName(name.slice(dot + 1))
        // 「空中下落攻击·预求身」→ 段落名「空中下落攻击」也作为关键词；裸动作词（普攻/重击）太泛，跳过
        const head = name.slice(0, dot)
        if (head.length >= 4 && !GENERIC_ACTION_WORDS.includes(head)) pushName(head)
    }
    return { byName, bySegment }
}

function segmentNumberIn(text: string): number[] {
    return [...text.matchAll(/第(\d+)段/g)].map((m) => Number(m[1]))
}

/** @desc 去掉段号（「普攻·预求身第3段」→「普攻·预求身」），用于判断两个名字是否同一技能的同一小节 */
function stripSegments(text: string): string {
    return text.replace(/第\d+段?/g, '')
}

/** @desc 两个倍率行名是否指同一条：去掉段号后同名，且双方都带段号时段号必须一致 */
function isSameSibling(candidate: string, own: string): boolean {
    if (candidate === own) return true
    const candidateSegments = segmentNumberIn(candidate)
    const ownSegments = segmentNumberIn(own)
    if (
        candidateSegments.length > 0 &&
        ownSegments.length > 0 &&
        candidateSegments.join(',') !== ownSegments.join(',')
    ) {
        return false
    }
    return stripSegments(candidate) === stripSegments(own)
}

/**
 * @desc 小节头名：为带段号的倍率行补一个去段号的名字（「空中攻击·枪弹暴雨第一段」→「空中攻击·枪弹暴雨」），
 * 让「整节共用一句结论」的写法能被正确归属；裸动作词（「普攻第一段」去段号后只剩「普攻」）太泛会误认领，故不补。
 */
function sectionTokens(tokens: string[]): string[] {
    const out = new Set(tokens)
    for (const token of tokens) {
        const stripped = stripSegments(token)
        if (stripped !== token && stripped.includes('·')) out.add(stripped)
    }
    return [...out]
}

interface NameRange {
    at: number
    end: number
    token: string
}

/**
 * @desc 这处出现其实是本行名字被更短的同族行名截断：文案只写「强光穿射」（本行叫「强光穿射每段」）、
 * 兄弟行名「强光」正好套在里面，不能算成别人的出现。
 */
function isOwnTruncation(plain: string, range: NameRange, ownSibling: string): boolean {
    if (!ownSibling || range.token === ownSibling) return false
    if (!ownSibling.startsWith(range.token)) return false
    // 出现处之后有多少字与本行名字重合：比行名本身长，说明这处其实是在说本行（只是漏写了后半截）
    const limit = Math.min(ownSibling.length, plain.length - range.at)
    let shared = range.token.length
    while (shared < limit && plain[range.at + shared] === ownSibling[shared]) shared++
    return shared > range.token.length
}

/** @desc 收集「别的倍率行名」在文案里的出现区间；嵌套出现的短名（「神来之笔」⊂「极意·神来之笔」）只保留最长者 */
function nameRanges(plain: string, tokens: string[], ownSibling = ''): NameRange[] {
    const ranges: NameRange[] = []
    for (const token of tokens) {
        if (token.length < 2) continue
        for (let from = 0; ;) {
            const at = plain.indexOf(token, from)
            if (at < 0) break
            ranges.push({ at, end: at + token.length, token })
            from = at + 1
        }
    }
    const keep = ranges.filter(
        (range) =>
            !isOwnTruncation(plain, range, ownSibling) &&
            !ranges.some(
                (other) =>
                    other !== range &&
                    other.at <= range.at &&
                    other.end >= range.end &&
                    other.end - other.at > range.end - range.at
            )
    )
    return keep.sort((a, b) => a.at - b.at)
}

/**
 * @desc 段号锚定：在包含「本次命中名/段号」的同一句里找「为 XX 伤害」，取距离最近的一条；
 * 若该结论所在**整句**出现了别的段号（如第 3 段写「为声骸技能伤害」而本次是第 1 段），则跳过，
 * 避免把邻段结论套到本段（游戏文案里同一句常并列多段）。
 * 两道额外护栏：
 * - 关键词若落在**别的倍率行名**里（「普攻」⊂「普攻·明悟」），说明这处出现属于那个技能，不算本次命中；
 * - 纯段号锚定（support 非空）要求该句同时出现本次命中的技能名，避免「第3段为空中下落攻击」这类别段描述被借用。
 */
function anchoredType(plain: string, phrases: Phrase[], options: AnchorOptions): string | null {
    const { needles, ownSegment, foreign, support } = options
    const inForeign = (at: number, length: number) =>
        foreign.some((range) => at >= range.at && at + length <= range.end && length < range.token.length)
    let best: { type: string; dist: number } | null = null
    for (const needle of needles) {
        let from = 0
        for (;;) {
            const at = plain.indexOf(needle, from)
            if (at < 0) break
            const atEnd = at + needle.length
            if (inForeign(at, needle.length)) {
                from = at + 1
                continue
            }
            for (const phrase of phrases) {
                if (at < phrase.sentenceStart || at >= phrase.sentenceEnd) continue
                const sentence = plain.slice(phrase.sentenceStart, phrase.sentenceEnd)
                if (support && support.length > 0 && !support.some((need) => sentence.includes(need))) continue
                if (ownSegment !== null) {
                    const segs = segmentNumberIn(sentence)
                    if (segs.length > 0 && !segs.includes(ownSegment)) continue
                }
                const dist = phrase.index >= atEnd ? phrase.index - atEnd : Math.max(0, at - phrase.index)
                if (!best || dist < best.dist) best = { type: phrase.type, dist }
            }
            from = at + 1
        }
    }
    return best?.type ?? null
}

interface AnchorOptions {
    /** @desc 定位关键词（技能名粒度或段号粒度） */
    needles: string[]
    /** @desc 使用段号关键词时，该句必须同时命中的技能名关键词 */
    support?: string[]
    /** @desc 本次命中自带的段号，用于排除「并列多段」的邻段结论 */
    ownSegment: number | null
    /** @desc 别的倍率行名占用的区间 */
    foreign: NameRange[]
}

/**
 * @desc 归属兜底（无锚点时的第二道判定）：一条「为 XX 伤害」结论归属于**它前面最近出现的倍率行名/小节头**。
 * 采用条件：
 * - 归属是本次命中、或本次命中所属的小节头（「空中攻击·枪弹暴雨持续扫射」⊂「空中攻击·枪弹暴雨」）、或前面没有任何行名；
 * - 该结论所在句若写明段号，则必须包含本次段号（避免邻段结论）；
 * - 剩下的结论只剩一个不同伤害类型，否则视为歧义（如洛瑟菈按模态二选一）而放弃。
 */
function ownedType(
    plain: string,
    phrases: Phrase[],
    ownSibling: string,
    siblings: string[],
    ownSegment: number | null
): string | null {
    const positions = nameRanges(plain, siblings, ownSibling)
        .map((range) => ({ token: range.token, at: range.at }))
        .sort((a, b) => a.at - b.at)
    const ownerAt = (index: number): string | null => {
        let owner: string | null = null
        for (const position of positions) {
            if (position.at >= index) break
            owner = position.token
        }
        return owner
    }

    const usable = phrases.filter((phrase) => {
        const owner = ownerAt(phrase.index)
        const owned =
            owner === null || isSameSibling(owner, ownSibling) || (owner.includes('·') && ownSibling.startsWith(owner))
        if (!owned) return false
        if (ownSegment === null) return true
        // 段号冲突只按**本分句**判断：「…第3段为空中下落攻击。」这类旁述不该否掉整节的结论
        const [clauseStart, clauseEnd] = boundsAt(plain, phrase.index, CLAUSE_SEPARATORS)
        const segs = segmentNumberIn(plain.slice(clauseStart, clauseEnd))
        return segs.length === 0 || segs.includes(ownSegment)
    })
    const distinct = new Set(usable.map((p) => p.type))
    return distinct.size === 1 ? [...distinct][0] : null
}

/**
 * @desc 名称徽标：倍率名紧贴在「XX 技能/XX【」之后（「共鸣技能【雾化子弹】」「共鸣技能飞身式·翻山越涧」）时，
 * 该前缀就是游戏给这条倍率标的伤害类型；「共鸣技能替换为狼舞的决意」这类中间夹了字的写法不算。
 * 类型词与规则1 保持同一套口径：空中攻击/闪避反击属普攻体系。
 */
const BADGE_TYPES: Array<[string, string]> = [
    ['空中攻击', '普攻伤害'],
    ['闪避反击', '普攻伤害'],
    ['共鸣技能', '共鸣技能伤害'],
    ['共鸣解放', '共鸣解放伤害'],
    ['声骸技能', '声骸技能伤害'],
    ['变奏技能', '变奏技能伤害'],
    ['延奏技能', '延奏技能伤害'],
    ['普攻', '普攻伤害'],
    ['重击', '重击伤害']
]
const BADGE_TYPE_MAP = new Map(BADGE_TYPES)
const ADJACENT_TYPE_RE = new RegExp(`(${BADGE_TYPES.map(([word]) => word).join('|')})【?$`)

function adjacentType(plain: string, needles: string[], foreign: NameRange[], headings: NameRange[]): string | null {
    const inHeading = (at: number, end: number) => headings.some((heading) => at < heading.end && end > heading.at)
    for (const needle of needles) {
        let from = 0
        for (;;) {
            const at = plain.indexOf(needle, from)
            if (at < 0) break
            const covered = foreign.some(
                (range) => at >= range.at && at + needle.length <= range.end && needle.length < range.token.length
            )
            if (!covered) {
                const match = ADJACENT_TYPE_RE.exec(plain.slice(Math.max(0, at - 8), at))
                const word = match?.[1]
                if (word) {
                    const wordEnd = at - (match[0].length - word.length)
                    // 标题名与正文粘在一起（「绮彩巡游·地面重击绮彩巡游状态期间…」），标题里那个类型词属于别的小节
                    if (!inHeading(wordEnd - word.length, wordEnd)) {
                        const type = BADGE_TYPE_MAP.get(word)
                        if (type) return type
                    }
                }
            }
            from = at + 1
        }
    }
    return null
}

interface MatchContext {
    hitName: string
    skillType?: string
    /** @desc 同一技能节点下的其它倍率行名（用于判断某条结论是否被别的技能认领） */
    siblings?: string[]
    requireAnchor?: boolean
}

/** @desc 大标题标记：上游富文本用小节标题（如 `<size=40><color=Title>重击</color></size>`）分隔技能内部的小节 */
const HEADING_RE = /<color=Title>([\s\S]*?)<\/color>/gi

interface RichSection {
    /** @desc 小节标题（首个标题之前的引言段为 ''） */
    heading: string
    /** @desc 小节原文（含标题元素自身） */
    text: string
}

/** @desc 按大标题把原文切成小节；无大标题时返回空数组 */
function splitSections(raw: string): RichSection[] {
    const matches = [...raw.matchAll(HEADING_RE)]
    if (matches.length === 0) return []
    const sections: RichSection[] = []
    const preamble = raw.slice(0, matches[0].index ?? 0)
    if (stripRichTags(preamble).trim()) sections.push({ heading: '', text: preamble })
    matches.forEach((match, i) => {
        const start = match.index ?? 0
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length
        sections.push({ heading: stripRichTags(match[1] ?? '').trim(), text: raw.slice(start, end) })
    })
    return sections
}

/**
 * @desc 纯文本 + 「大标题」占位区间：标题名会和小节正文粘在一起（「绮彩巡游·地面重击绮彩巡游状态期间…」），
 * 名称徽标判定要能认出标题里那几个字（它们是别的小节名，不是本行的类型徽标）。
 */
function plainTextWithHeadings(raw: string): { plain: string; headings: NameRange[] } {
    const parts: Array<{ text: string; heading: boolean }> = []
    let last = 0
    for (const match of raw.matchAll(HEADING_RE)) {
        const at = match.index ?? 0
        parts.push({ text: raw.slice(last, at), heading: false })
        parts.push({ text: match[1] ?? '', heading: true })
        last = at + match[0].length
    }
    parts.push({ text: raw.slice(last), heading: false })
    let plain = ''
    const headings: NameRange[] = []
    for (const part of parts) {
        const stripped = normalizeNumerals(stripRichTags(part.text))
        if (part.heading && stripped) {
            headings.push({ at: plain.length, end: plain.length + stripped.length, token: stripped })
        }
        plain += stripped
    }
    return { plain, headings }
}

/**
 * @desc 把匹配范围收窄到本次倍率所属的**大标题小节**，按可信度返回候选小节文案：
 * 1) 标题名与倍率名互相包含（标题「重击」↔倍率「重击」、标题「普攻·心眼·征」↔倍率「心眼·征伤害」），标题越长越具体，排在前；
 * 2) 小节正文里出现倍率名的小节（「热压弹伤害」的结论写在「共鸣技能·咔咔压制」小节里，而标题「热压弹获取规则」只是资源规则）。
 * 文案没有大标题、或没有任何小节提到该倍率时返回空数组（调用方按整段文案匹配，行为与从前一致）。
 */
function sectionTextsForHit(raw: string, hitName: string, skillType?: string): string[] {
    const sections = splitSections(raw)
    if (sections.length === 0) return []
    const { byName } = needlesForHit(hitName, skillType)
    const needles = byName.slice().sort((a, b) => b.length - a.length)
    const byHeading = sections
        .filter(
            (section) =>
                section.heading &&
                needles.some((needle) => needle.includes(section.heading) || section.heading.includes(needle))
        )
        .sort((a, b) => b.heading.length - a.heading.length)
    const byBody = needles.flatMap((needle) =>
        sections.filter((section) => !byHeading.includes(section) && stripRichTags(section.text).includes(needle))
    )
    return [...byHeading, ...byBody].map((section) => section.text)
}

/** @desc 在单段文案里做规则2匹配：先按技能名锚定「为 XX 伤害」，再看名称徽标，最后受约束的归属兜底 */
function matchInText(text: string, options: MatchContext, allowBadge = true): string | null {
    const { plain, headings } = plainTextWithHeadings(text)
    if (!plain) return null
    const phrases = collectPhrases(plain)

    const ownSibling = siblingToken(normalizeNumerals(options.hitName ?? ''))
    const ownTokens = sectionTokens(
        [...new Set((options.siblings ?? []).map((sibling) => siblingToken(normalizeNumerals(sibling))))].filter(
            (sibling) => sibling.length >= 2
        )
    )
    // 本行行名（含去段号的小节头名）也要参与归属判定：整节共用一句结论时，结论的归属正是本行或本节
    const foreign = nameRanges(plain, ownTokens, ownSibling)
    const { byName, bySegment } = needlesForHit(options.hitName ?? '', options.skillType)
    const ownSegment = (() => {
        const seg = /第(\d+)段/.exec(normalizeNumerals(options.hitName ?? ''))
        return seg ? Number(seg[1]) : null
    })()

    // 先按技能名锚定（同一 desc 里可能并列多个技能/多段），再退到纯段号锚定
    const anchored =
        phrases.length > 0
            ? (anchoredType(plain, phrases, { needles: byName, ownSegment, foreign }) ??
              anchoredType(plain, phrases, { needles: bySegment, support: byName, ownSegment, foreign }))
            : null
    if (anchored) return anchored
    // 名称徽标不需要「为 XX 伤害」句式，所以放在句式收集的空判之前
    if (allowBadge) {
        const adjacent = adjacentType(plain, byName, foreign, headings)
        if (adjacent) return adjacent
    }
    if (options.requireAnchor || phrases.length === 0) return null
    return ownedType(plain, phrases, ownSibling, ownTokens, ownSegment)
}

/**
 * @desc 对单段文案做规则2匹配：先收窄到所属大标题小节，再分两轮——
 * 第一轮只认「XX 伤害为 YY 伤害」的明写结论，第二轮才认名称徽标。
 * 分轮是因为徽标会被交叉引用骗到（「施放普攻凌霄·普攻第4段」里的「普攻」属于被引用技能名，
 * 而该技能自己写着「此次伤害为共鸣技能伤害」），明写结论必须优先。
 * 有候选小节时只在小节里找结论：一个都没有也不回退整段，否则会把别的小节的结论抄过来。
 */
export function matchSkillTextOverride(text: string, ctx?: MatchContext | string, skillType = ''): string | null {
    const options: MatchContext = typeof ctx === 'string' ? { hitName: ctx, skillType } : (ctx ?? { hitName: '' })
    const candidates = sectionTextsForHit(text, options.hitName ?? '', options.skillType)
    const texts = candidates.length > 0 ? candidates : [text]
    for (const allowBadge of [false, true]) {
        for (const candidate of texts) {
            const result = matchInText(candidate, options, allowBadge)
            if (result) return result
        }
    }
    return null
}

/** @desc 规则1：倍率名命中「普攻·/重击·/空中攻击/闪避反击/共鸣技能·/…」前缀时返回对应伤害类型 */
export function matchHitNamePrefix(hitName: string): string | null {
    for (const [prefix, type] of NAME_PREFIX_TYPES) {
        if (hitName.includes(prefix)) return type
    }
    return null
}

/** @desc 取出与该伤害条目相关的技能文案（精确命中行 → 同技能类型 → 全部技能，逐级兜底） */
export function skillDescriptionsFor(
    info: CharacterInfo | null | undefined,
    entry: Pick<DamageEntry, 'hitName' | 'skillType'>
): string[] {
    const skills = info?.skills
    if (!Array.isArray(skills) || skills.length === 0) return []
    const exact = skills.filter((s) => (s.values ?? []).some((v) => v[0] === entry.hitName))
    const byType = skills.filter((s) => s.type === entry.skillType)
    const pool = exact.length > 0 ? exact : byType.length > 0 ? byType : skills
    return [...new Set(pool.map((s) => s.desc ?? '').filter(Boolean))]
}

interface CandidateSkill {
    desc: string
    /** @desc 同一技能节点的倍率行名（用于「结论是否被别的技能认领」判定） */
    siblings: string[]
}

function matchInSkills(skills: CandidateSkill[], entry: Pick<DamageEntry, 'hitName' | 'skillType'>) {
    for (const skill of skills) {
        const hit = matchSkillTextOverride(skill.desc, {
            hitName: entry.hitName,
            skillType: entry.skillType,
            siblings: skill.siblings
        })
        if (hit) return hit
    }
    return null
}

/**
 * @desc 规则2 的入口：在**该倍率所属技能节点**的文案里找「视为/为 XX 伤害」。
 * 归属原则：倍率来自哪个技能，就只在该技能的文案里找结论——绝不跨技能搜索。
 * 否则别的小节里的同类词（「施放重击时…为共鸣技能伤害」里的裸词「重击」、
 * 「共鸣技能伤害」里的子串「技能伤害」）会把结论错误地锚到本次命中。
 * 调用方额外提供的文案（extraDescs，目前是首位声骸的技能文案）仅用于该条目自身的技能文案缺失时。
 */
export function inferFromSkillText(
    info: CharacterInfo | null | undefined,
    entry: Pick<DamageEntry, 'hitName' | 'skillType'>,
    extraDescs: string[] = []
): string | null {
    const skills = Array.isArray(info?.skills) ? info.skills : []
    const toCandidate = (s: (typeof skills)[number]): CandidateSkill => ({
        desc: s.desc ?? '',
        siblings: (s.values ?? []).map((v) => v[0])
    })
    // 只认「技能类型 + 倍率行名」都对得上的那个节点；找不到再退到同技能类型的节点
    const exact = skills
        .filter((s) => s.type === entry.skillType && (s.values ?? []).some((v) => v[0] === entry.hitName))
        .map(toCandidate)
    const byType = skills.filter((s) => s.type === entry.skillType).map(toCandidate)
    const primary = exact.length > 0 ? exact : byType
    return (
        matchInSkills(primary, entry) ??
        matchInSkills(
            extraDescs.map((desc) => ({ desc, siblings: [] })),
            entry
        )
    )
}

/**
 * @desc 声骸技能条目的候选文案索引（entryId → 首位声骸技能文案）：
 * 声骸技能来自角色的「首位声骸」，其文案挂在 EchoInfo.skill.desc 上，按角色槽位的首位声骸名取。
 */
export function buildEchoDescByEntry(
    entries: Array<Pick<DamageEntry, 'id' | 'character' | 'skillType'>>,
    team: Array<Pick<CharSlot, 'character' | 'echoes'>>,
    echoSkillText: Record<string, string>
): Record<string, string> {
    const echoByChar = new Map<string, string>()
    for (const slot of team) {
        if (slot.character) echoByChar.set(slot.character, slot.echoes?.[0]?.name ?? '')
    }
    const out: Record<string, string> = {}
    for (const entry of entries) {
        if (entry.skillType !== '声骸技能') continue
        const echoName = entry.character ? echoByChar.get(entry.character) : ''
        const desc = echoName ? echoSkillText[echoName] : ''
        if (desc) out[entry.id] = desc
    }
    return out
}
