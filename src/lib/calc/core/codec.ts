/**
 * @desc 交换格式编解码：**字符串只出现在导出边界**，引擎内部一律是数值 + 显式单位。
 *
 * 「值直接传字符串，根据有无百分号定单位」这条约定在这里落地（也是唯一实现）：
 * - `encodeValue(25, '%')` → `'25%'`
 * - `decodeValue('25%')` → `{ value: 25, unit: '%' }`
 *
 * 为什么不把字符串当内部模型：引擎每处运算都要 parse，且单位真源会分裂成两份
 * （`ZONE_MAP` 的 `unit` 与字符串里的 `%`）。这份编解码只服务「表格 / JSON 交换」这一侧。
 */
import type { BuffCondition, BuffInstance, BuffZoneValue, ZoneRef } from '$lib/calc/calculation.types'
import { ACTION_MAP, REF_SOURCE_MAP } from '$coconut/actions'

/** @desc 单位：百分比 / 固定值 */
export type ValueUnit = '%' | 'flat'

/** @desc 一个「作用 → 值」的平铺条目（key 为作用 id） */
export interface EncodedEffect {
    key: string
    /** @desc 数值字符串（带 `%` 即百分比）或引用（转模） */
    value: string | { ref: ZoneRef }
    override?: boolean
    condition?: BuffCondition
}

/** @desc 一个 Buff 的交换形态（多作用列表，与 `BuffInstance.zones` 一一对应） */
export interface EncodedBuff {
    id: string
    name: string
    effects: EncodedEffect[]
    scope: 'all' | number[]
}

/** @desc 数值 + 单位 → 字符串（百分比带 `%` 后缀） */
export const encodeValue = (value: number, unit: ValueUnit): string => (unit === '%' ? `${value}%` : `${value}`)

/** @desc 字符串 → 数值 + 单位（按有无 `%` 判断；无法解析的数值按 0） */
export const decodeValue = (raw: string): { value: number; unit: ValueUnit } => {
    const text = raw.trim()
    const pct = text.endsWith('%')
    const parsed = Number.parseFloat(pct ? text.slice(0, -1) : text)
    return { value: Number.isFinite(parsed) ? parsed : 0, unit: pct ? '%' : 'flat' }
}

/** @desc 作用 id 的注册表单位（未登记的 id 按固定值处理） */
const unitOf = (actionId: string): ValueUnit => ACTION_MAP.get(actionId)?.unit ?? 'flat'

/** @desc 引擎乘区条目 → 交换条目 */
export const encodeEffect = (zone: BuffZoneValue): EncodedEffect => ({
    key: zone.zoneId,
    value: zone.ref ? { ref: zone.ref } : encodeValue(zone.value, unitOf(zone.zoneId)),
    ...(zone.override ? { override: true } : {}),
    ...(zone.condition ? { condition: zone.condition } : {})
})

/** @desc 交换条目 → 引擎乘区条目（未知作用 id 直接丢弃，避免脏数据进引擎） */
export const decodeEffect = (effect: EncodedEffect): BuffZoneValue | null => {
    if (!ACTION_MAP.has(effect.key)) return null
    const zone: BuffZoneValue = { zoneId: effect.key as BuffZoneValue['zoneId'], value: 0 }
    if (typeof effect.value === 'string') {
        // 字符串里的 % 只是单位标注；引擎内部一律存「百分比点 / 固定值」的数值
        zone.value = decodeValue(effect.value).value
    } else {
        const ref = effect.value.ref
        // 引用目标必须在引用来源注册表里，否则读不到值
        zone.value = 0
        if (!REF_SOURCE_MAP.has(ref.zoneId)) return null
        zone.ref = ref
    }
    if (effect.override) zone.override = true
    if (effect.condition) zone.condition = effect.condition
    return zone
}

/** @desc Buff 实例 → 交换形态 */
export const encodeBuff = (buff: BuffInstance): EncodedBuff => ({
    id: buff.id,
    name: buff.name,
    effects: buff.zones.map(encodeEffect),
    scope: buff.scope
})

/** @desc 交换形态 → Buff 实例（丢弃无法识别的作用） */
export const decodeBuff = (buff: EncodedBuff): BuffInstance => ({
    id: buff.id,
    name: buff.name,
    zones: buff.effects.map(decodeEffect).filter((zone): zone is BuffZoneValue => zone !== null),
    scope: buff.scope
})
