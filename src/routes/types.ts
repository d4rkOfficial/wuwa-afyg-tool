/**
 * @desc `src/routes/+page.svelte`（唯一页面路由 `/`）的**路由级类型**（AGENTS §2）。
 *
 * 只放「本路由自己拥有」的形状：跨路由复用的类型一律留在 `$lib/types/`（如 `PhaseKey` / `CharSlot`），
 * 本文件只是把原先内联在 `+page.svelte` 里、且被多个路由级模块共用的别名收拢起来。
 */
import type { PhaseKey, Project } from '$lib/types/project'

/** @desc 队伍三槽位元组（`Project['team']` 的别名；页面里原先内联写了两次 `[CharSlot, CharSlot, CharSlot]`） */
export type TeamSlots = Project['team']

/** @desc 「克隆工程」弹窗的阶段勾选表：四阶段的保留与否（`结果页` 单独一项，不在本表内） */
export type PhaseSelectionMap = Record<PhaseKey, boolean>
