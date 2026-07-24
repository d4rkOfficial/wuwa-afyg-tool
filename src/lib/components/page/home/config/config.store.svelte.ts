import type { ConfigState } from './config.types'
import { defaultConfig } from './config.consts'
import { SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
import { addToast } from '$lib/data/toast.svelte'

let _config = $state<ConfigState>(defaultConfig())
let _locked = $state(false)

function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁后编辑。编辑产生的副作用需您来承担。', 'info')
        return false
    }
    return true
}

export function init(data: ConfigState | null, locked = false) {
    _locked = locked
    if (data) {
        _config = JSON.parse(JSON.stringify(data))
    } else {
        _config = defaultConfig()
    }
}

export function getConfig(): ConfigState {
    return _config
}

export function getCharacterConfig(index: number) {
    return _config.characters[index]
}

export function getEchoSlot(charIndex: number, slotIndex: number) {
    return _config.characters[charIndex].echoes[slotIndex]
}

export function setEchoCost(charIndex: number, slotIndex: number, cost: number) {
    if (!assertUnlocked()) return
    const slots = _config.characters[charIndex].echoes
    const other = slots.reduce((s, e, i) => s + (i === slotIndex ? 0 : e.cost), 0)
    if (other + cost > 12) return
    _config.characters[charIndex].echoes[slotIndex].cost = cost
    _config.characters[charIndex].echoes[slotIndex].mainStat = null
    const sec = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
    _config.characters[charIndex].echoes[slotIndex].secondMainStat = sec
        ? { type: sec.label, value: sec.value, unit: sec.unit }
        : null
}

export function setMainStat(
    charIndex: number,
    slotIndex: number,
    stat: { type: string; value: number; unit: string } | null
) {
    if (!assertUnlocked()) return
    _config.characters[charIndex].echoes[slotIndex].mainStat = stat
}

export function addSubstat(charIndex: number, slotIndex: number, label: string) {
    if (!assertUnlocked()) return
    const slots = _config.characters[charIndex].echoes[slotIndex]
    if (slots.substats.length >= 5) return
    if (slots.substats.some((s) => s.type === label)) return
    const opt = SUBSTAT_OPTIONS.find((o) => o.label === label)
    const value = opt ? opt.tiers[Math.floor((opt.tiers.length - 1) / 2)] : 0
    slots.substats = [...slots.substats, { type: label, value, unit: opt?.unit ?? '' }]
}

export function removeSubstat(charIndex: number, slotIndex: number, idx: number) {
    if (!assertUnlocked()) return
    const slots = _config.characters[charIndex].echoes[slotIndex]
    slots.substats = slots.substats.filter((_, i) => i !== idx)
}

export function updateSubstatValue(charIndex: number, slotIndex: number, idx: number, value: number) {
    if (!assertUnlocked()) return
    _config.characters[charIndex].echoes[slotIndex].substats[idx].value = value
}

export function updateEnemy<K extends keyof ConfigState['enemy']>(key: K, value: ConfigState['enemy'][K]) {
    if (!assertUnlocked()) return
    _config.enemy[key] = value
}

export function updateResistance(element: string, value: number) {
    if (!assertUnlocked()) return
    _config.enemy.resistances[element] = value
}

export function moveSubstat(charIndex: number, slotIndex: number, fromIdx: number, toIdx: number) {
    if (!assertUnlocked()) return
    const slots = _config.characters[charIndex].echoes[slotIndex]
    const item = slots.substats[fromIdx]
    const arr = slots.substats.filter((_, i) => i !== fromIdx)
    arr.splice(toIdx, 0, item)
    slots.substats = arr
}

export function getCalcState(): ConfigState {
    return JSON.parse(JSON.stringify(_config))
}
