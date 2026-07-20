import type { ConfigState } from './config.types'
import { defaultConfig } from './config.consts'
import { SECOND_MAIN_STAT } from '$lib/consts/stat-data'

let _config = $state<ConfigState>(defaultConfig())
let _locked = $state(false)

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
    if (_locked) return
    const slots = _config.characters[charIndex].echoes
    const other = slots.reduce((s, e, i) => s + (i === slotIndex ? 0 : e.cost), 0)
    if (other + cost > 12) return
    _config.characters[charIndex].echoes[slotIndex].cost = cost
    _config.characters[charIndex].echoes[slotIndex].mainStat = null
    _config.characters[charIndex].echoes[slotIndex].substats = []
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
    if (_locked) return
    _config.characters[charIndex].echoes[slotIndex].mainStat = stat
}

export function addSubstat(charIndex: number, slotIndex: number, label: string) {
    if (_locked) return
    const slots = _config.characters[charIndex].echoes[slotIndex]
    if (slots.substats.length >= 5) return
    if (slots.substats.some((s) => s.type === label)) return
    slots.substats = [...slots.substats, { type: label, value: 0, unit: '' }]
}

export function removeSubstat(charIndex: number, slotIndex: number, idx: number) {
    if (_locked) return
    const slots = _config.characters[charIndex].echoes[slotIndex]
    slots.substats = slots.substats.filter((_, i) => i !== idx)
}

export function updateSubstatValue(charIndex: number, slotIndex: number, idx: number, value: number) {
    if (_locked) return
    _config.characters[charIndex].echoes[slotIndex].substats[idx].value = value
}

export function updateEnemy<K extends keyof ConfigState['enemy']>(key: K, value: ConfigState['enemy'][K]) {
    if (_locked) return
    _config.enemy[key] = value
}

export function updateResistance(element: string, value: number) {
    if (_locked) return
    _config.enemy.resistances[element] = value
}

export function getCalcState(): ConfigState {
    return JSON.parse(JSON.stringify(_config))
}
