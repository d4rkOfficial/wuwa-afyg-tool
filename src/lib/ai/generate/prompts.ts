// 提示词渲染：注入乘区白名单/引用白名单/生效条件（按实体类型裁剪）/用户命名规则
import { ZONE_DEFS, ZONE_REF_DEFS } from '$lib/calc/calculation.consts'
import {
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_INITIAL_TASK_PROMPT,
    DEFAULT_NAMING_RULES_TEXT,
    CONDITION_CHAIN_RULES_TEXT,
    CONDITION_REFINE_RULES_TEXT,
    CONDITION_COMMON_RULES_TEXT
} from './prompts.config'

// 乘区白名单表（保留在 system，作为 zoneId 校验边界）
export const ZONE_LIST_TEXT = ZONE_DEFS.map(
    (z) => `- ${z.id}（${z.label}，单位：${z.unit === '%' ? '百分数' : '固定值'}）`
).join('\n')

// 引用乘区表（保留在 system，作为 ref.targetZoneId 校验边界）
export const REF_ZONE_LIST_TEXT = ZONE_REF_DEFS.map(
    (z) => `- ${z.id}（${z.label}，单位：${z.unit === '%' ? '百分数' : '固定值'}）`
).join('\n')

// 生效条件规则按实体类型裁剪：角色才讲 chain，武器才讲 refinement，其他只讲属性/类型
export function renderConditionRules(entityType?: string): string {
    const parts: string[] = []
    if (entityType === 'character') parts.push(CONDITION_CHAIN_RULES_TEXT)
    if (entityType === 'weapon') parts.push(CONDITION_REFINE_RULES_TEXT)
    parts.push(CONDITION_COMMON_RULES_TEXT)
    return parts.join('\n')
}

// 命名规则：用户自定义规则优先；未定义时用宽松默认兜底。叠层/精炼拆分是计算语义，永远保留。
export function renderNamingRules(userRule: string): string {
    const head = userRule
        ? `用户自定义命名规则（必须严格遵守，这是用户从零定义的风格）：\n${userRule}`
        : DEFAULT_NAMING_RULES_TEXT
    const split = `

叠层/精炼拆分（计算语义，必须遵守，不受命名风格影响）：
- 同一增益分多层/多阶生效（如"每层+5%，可叠4层"），拆成多条独立 buff，名称末尾用「N层」区分（每层一条）。
- 每层 value 填"该层的新增数值"：第 n 层 = 第 n 层效果值 − 第 n-1 层效果值。
  例：1/2/3 层效果为 20/40/80 → 1层=20、2层=20、3层=40；每层+5%可叠4层 → 各层都填 5。
- 原因：工具箱把各层 buff 全部叠加计算，只有填增量才能得到正确累计值。
- 武器精炼按阶拆分同理：1-5 阶各填该阶增量（见 get_condition_rules 的武器精炼规则）。`
    return head + split
}

export interface RenderSystemContext {
    entityType?: string
    namingRule?: string
}

export function renderSystemPrompt(template: string, ctx: RenderSystemContext = {}): string {
    return template
        .replaceAll('{ZONE_LIST}', ZONE_LIST_TEXT)
        .replaceAll('{REF_ZONE_LIST}', REF_ZONE_LIST_TEXT)
        .replaceAll('{CONDITION_RULES}', renderConditionRules(ctx.entityType))
        .replaceAll('{NAMING_RULES}', renderNamingRules(ctx.namingRule?.trim() ?? ''))
}

export interface RenderUserContext {
    entityType: string
    entityName: string
}

export function renderInitialTaskPrompt(template: string, { entityType, entityName }: RenderUserContext): string {
    const label = ENTITY_TYPE_LABELS[entityType as keyof typeof ENTITY_TYPE_LABELS] ?? entityType
    return template
        .replaceAll('{ENTITY_TYPE}', label)
        .replaceAll('{ENTITY_TYPE_RAW}', entityType)
        .replaceAll('{ENTITY_NAME}', entityName)
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
    character: '角色',
    weapon: '武器',
    echo: '首位声骸',
    '1set': '套装 1件',
    '2set': '套装 2件',
    '3set': '套装 3件',
    '4set': '套装 4件',
    '5set': '套装 5件'
}

export { DEFAULT_SYSTEM_PROMPT, DEFAULT_INITIAL_TASK_PROMPT }
