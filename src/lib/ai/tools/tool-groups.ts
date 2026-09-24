/**
 * @desc AI/WS 工具的展示分组与短描述（供提示词编辑弹窗的「可调用工具」列表用）。
 *  工具定义里只有面向模型的完整 description，这里再按业务域细分归类，并压出一句短描述。
 */
import type { ToolDefinition } from '$lib/ai/tools/registry'

/** @desc 分组规则：按顺序匹配，先命中者胜（越具体的放越前面） */
const GROUP_RULES: { label: string; test: RegExp }[] = [
    { label: '库街区 · 词条集同步', test: /_kuro_|^kuro_|^check_kuro_login$|^refresh_kuro_echo_data$|_from_kuro$/ },
    { label: '词条集（方案）', test: /_substat_plan/ },
    { label: 'Buff 生成', test: /^generate_|_naming_rule$|^get_entity_info$|^list_entities$|^search_entities$/ },
    { label: 'Buff 集（实体词条）', test: /buff_library|_entity_buffs|_buff_entit/ },
    {
        label: '计算 · Buff 集与条件',
        test: /buff_set|_buff_zone|^bind_buff|^unbind_buff|^import_entity_buffs|condition|^toggle_damage_type$|^set_entry_damage_types$/
    },
    { label: '计算 · 条目与档位', test: /^set_chain$|^set_refinement$|^get_damage_entries$|^set_buff_scope$/ },
    { label: '配队', test: /^team|_team|member/ },
    {
        label: '时间轴',
        test: /timeline|_block|_ref_line|^get_char_skills$|^reflow_track$|^get_non_direct_options$/
    },
    { label: '结果与图表', test: /^get_result|^get_data_analysis|breakdown/ },
    {
        label: '声骸配置',
        test: /^set_main_stat$|^set_echo_cost$|^add_substat$|^remove_substat$|^update_substat_value$|^get_config_summary$|^update_enemy$|^update_resistance$/
    },
    { label: '工程与归档', test: /project|archive|phase/ },
    { label: '面板与视图', test: /_panel|^switch_view$|^set_view|^request_view$/ },
    { label: '设置', test: /setting|keymap|shortcut|ai_profile|workshop|cache|theme|background|surface|provider/ }
]

const OTHER_LABEL = '其它工具'

/** @desc 取描述的第一句作为短描述（面板上显示用，过长再截断） */
export const toolSummary = (description: string): string => {
    const first = String(description ?? '')
        .split(/[。；\n]/)[0]
        .trim()
    return first.length > 46 ? `${first.slice(0, 46)}…` : first
}

export interface ToolGroup {
    label: string
    items: { name: string; desc: string; full: string }[]
}

/** @desc 把工具定义按业务域分组（保持组内原顺序，组按规则顺序排列，未命中归「其它工具」） */
export const groupToolDefinitions = (definitions: ToolDefinition[]): ToolGroup[] => {
    const groups = new Map<string, ToolGroup>()
    const ensure = (label: string): ToolGroup => {
        const existing = groups.get(label)
        if (existing) return existing
        const created: ToolGroup = { label, items: [] }
        groups.set(label, created)
        return created
    }
    for (const def of definitions) {
        const name = def.function.name
        const label = GROUP_RULES.find((rule) => rule.test.test(name))?.label ?? OTHER_LABEL
        ensure(label).items.push({ name, desc: toolSummary(def.function.description), full: def.function.description })
    }
    const ordered = GROUP_RULES.map((rule) => groups.get(rule.label)).filter((g): g is ToolGroup => !!g?.items.length)
    const other = groups.get(OTHER_LABEL)
    if (other?.items.length) ordered.push(other)
    return ordered
}
