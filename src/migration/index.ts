/**
 * @desc 通用数据迁移器（公共入口）：把任意历史版本的工程 / 拉表计算态数据升级到当前版本。
 *
 * 设计要点：
 * - 单一入口（migrateProject / migrateCalcState），IndexedDB 载入、本地导入、工坊分享下载、
 *   AI 工具导入、旧导出文件全部走同一路径，避免多份升级逻辑漂移。
 * - 迁移链式执行 + 幂等：`from < CURRENT` 的迁移按序跑，已是最新版本直接返回归一化结果。
 * - 纯函数：不依赖任何 store / 浏览器 API，可在 Node 环境下直接单测。
 *
 * 模块拆分：shared（常量 / 通用工具 / 队伍归一化）· buff（乘区与 CalcState 归一化）·
 * timeline（排轴结构性迁移）· buff-folders（文件夹命名迁移）· versions（版本链）· project（工程入口）。
 */

export {
    VERSIONLESS_ASSUME_CURRENT_AFTER,
    deepClone,
    emptyCharSlot,
    emptyEchoSlot,
    emptyEncounter,
    type Migration
} from './shared'
export {
    isEmptyBuff,
    migrateCalcState,
    normalizeBuff,
    normalizeCalcState,
    normalizeZoneList,
    normalizeZones
} from './buff'
export { migrateHeavyPressOpBlocks, dedupeDamageBlockIds } from './timeline'
export { migrateBuffFolderNaming } from './buff-folders'
export { conditionProfileFromTeam, migrateProject, readVersion, toPlainProject } from './project'
export { PHASE_ORDER } from './shared'
