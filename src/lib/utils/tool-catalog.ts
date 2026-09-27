/**
 * @desc 可调用工具清单（提示词 / 技能等编辑弹窗右侧面板共用）。
 *  - 「Buff 生成流程」是生成管线专用工具表
 *  - 其余取自 `buildTools()` 并按业务域分组（分组规则见 `tool-groups.ts`）
 */
import { GENERATE_TOOLS } from '$lib/ai/generate/tools'
import { buildTools } from '$lib/ai/tools'
import { groupToolDefinitions, toolSummary, type ToolGroup } from '$lib/ai/tools/tool-groups'

export const buildToolGroups = (): ToolGroup[] => [
    {
        label: 'Buff 生成流程',
        items: GENERATE_TOOLS.map((t) => ({
            name: t.function.name,
            desc: toolSummary(t.function.description),
            full: t.function.description
        }))
    },
    ...groupToolDefinitions(buildTools())
]

export type { ToolGroup }
