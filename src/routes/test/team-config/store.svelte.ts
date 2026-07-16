import { DEFAULT_TEAM } from './consts'
import type { TeamConfig } from './types'

let team = $state<TeamConfig>(structuredClone(DEFAULT_TEAM))

export function getTeam() {
    return team
}

export function resetTeam() {
    team = structuredClone(DEFAULT_TEAM)
}
