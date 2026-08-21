// 弹窗面板工具：AI 查看/开关所有已注册弹窗
import { defineTool } from './registry'
import { getPanelsState, openPanel } from '../panels.svelte'

defineTool('get_panels_state', {
    description: '查看当前所有弹窗面板的开关状态（BUFF配置/速查/Buff 集/设置/工坊/角色详情配置/导入 Buff 集等）。',
    parameters: { type: 'object', properties: {} },
    handler: () =>
        Object.entries(getPanelsState()).map(([name, open]) => ({
            name,
            open
        }))
})

defineTool('open_panel', {
    description:
        '打开或关闭指定弹窗面板。panel 取 get_panels_state 返回的 name（如 buff-config/quick-lookup/buff-library/settings/workshop/character-detail/buff-import/damage-list 等）；open 默认 true。',
    parameters: {
        type: 'object',
        properties: {
            panel: { type: 'string', description: '面板名' },
            open: { type: 'boolean', description: '打开(true)/关闭(false)，默认 true' }
        },
        required: ['panel']
    },
    handler: (args) => {
        const panel = String(args.panel ?? '').trim()
        const open = args.open !== false
        const ok = openPanel(panel, open)
        if (!ok) {
            const known = Object.keys(getPanelsState()).join('、')
            throw new Error(`未知面板：${panel}（已知：${known}）`)
        }
        return { panel, open }
    }
})
