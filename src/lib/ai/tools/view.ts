// 视图切换工具：AI 可切换当前阶段视图（team/timeline/calculation/config/result），由宿主执行实际切换
import { defineTool } from './registry'

const VIEWS = ['team', 'timeline', 'calculation', 'config', 'result']

defineTool('switch_view', {
    description:
        '切换当前视图（阶段）：team=队伍配置、timeline=排轴、calculation=拉表、config=配装、result=结果页。切换后用户会看到相应界面。',
    parameters: {
        type: 'object',
        properties: { view: { type: 'string', enum: VIEWS, description: '目标视图' } },
        required: ['view']
    },
    handler: (args, ctx) => {
        const view = String(args.view ?? '')
        if (!VIEWS.includes(view)) throw new Error(`无效视图：${view}`)
        if (!ctx.requestView) throw new Error('当前环境不支持切换视图')
        ctx.requestView(view)
        return { switched: view }
    }
})
