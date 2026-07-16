import type { EchoConfig, TeamConfig } from './types'

const emptyEcho = (): EchoConfig => ({
    name: null,
    cost: 0,
    set: null,
    mainStat: null,
    secondMainStat: null,
    substats: []
})

export const DEFAULT_TEAM: TeamConfig = {
    characters: [
        {
            id: 'slot-1',
            name: null,
            weapon: null,
            echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]
        },
        {
            id: 'slot-2',
            name: null,
            weapon: null,
            echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]
        },
        {
            id: 'slot-3',
            name: null,
            weapon: null,
            echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]
        }
    ]
}
