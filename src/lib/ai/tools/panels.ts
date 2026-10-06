// 弹窗面板工具：AI 查看/开关所有已注册弹窗
import { defineTool } from './registry'
import { getPanelsState, openPanel } from '../panels.svelte'
import { getActiveProject, setActiveProject } from '$lib/data/project.svelte'
import { tick } from 'svelte'

defineTool('get_panels_state', {
    description:
        '查看当前所有弹窗面板的开关状态（工程 Buff 配置/速查/主页 Buff 集/设置/工坊/角色详情配置/从 Buff 集导入工程 Buff 配置等）。',
    parameters: { type: 'object', properties: {} },
    handler: () =>
        Object.entries(getPanelsState()).map(([name, open]) => ({
            name,
            open
        }))
})

defineTool('open_panel', {
    description:
        '打开或关闭指定弹窗面板：buff-set=主页 Buff 集（打开时先返回主页）；buff-conf=当前工程拉表的工程 Buff 配置；buff-conf-import=从 Buff 集导入工程 Buff 配置。两者是不同入口，用户说“打开 Buff 集”时用 buff-set，含义不清时先用 ask_user 确认。其它 panel 取 get_panels_state 返回的 name（quick-lookup/substat-library/settings/workshop/character-detail/damage-list 等）；open 默认 true。',
    parameters: {
        type: 'object',
        properties: {
            panel: {
                type: 'string',
                description:
                    'buff-set=主页 Buff 集；buff-conf=工程 Buff 配置；buff-conf-import=导入工程 Buff 配置；其它见 get_panels_state'
            },
            open: { type: 'boolean', description: '打开(true)/关闭(false)，默认 true' }
        },
        required: ['panel']
    },
    handler: async (args, ctx) => {
        const panel = String(args.panel ?? '').trim()
        const open = args.open !== false
        if (!Object.hasOwn(getPanelsState(), panel) && panel !== 'buff-conf-import')
            throw new Error(`未知面板：${panel}（已知：${Object.keys(getPanelsState()).join('、')}）`)
        if (open && panel === 'buff-set') await setActiveProject('')
        if (open && (panel === 'buff-conf' || panel === 'buff-conf-import')) {
            if (!getActiveProject()) throw new Error('请先打开工程，再打开工程 Buff 配置')
            if (ctx.requestView) {
                ctx.requestView('calculation')
                await tick()
            }
        }
        const ok = openPanel(panel, open)
        if (!ok) {
            const known = Object.keys(getPanelsState()).join('、')
            throw new Error(`未知面板：${panel}（已知：${known}）`)
        }
        return { panel, open }
    }
})
