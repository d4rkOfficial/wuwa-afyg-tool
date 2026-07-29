export interface MultiplierZone {
    label: string
    value: number
    detail: string
}

export interface ResultEntry {
    id: string
    character: string
    hitName: string
    skillType: string
    displayName: string
    element: string
    ratioNum: number
    hits: number
    sourceTimelineBlockId: string

    // computed
    baseValue: number
    baseUnit: string
    totalMultiplier: number
    baseAtk: number
    totalAtk: number
    atkPctSum: number
    atkFlatSum: number
    baseHp: number
    totalHp: number
    hpPctSum: number
    hpFlatSum: number
    baseDef: number
    totalDef: number
    defPctSum: number
    defFlatSum: number
    totalTuneBreakBoost: number
    dmgBonus: number
    deepen: number
    critRate: number
    critDmg: number
    defMulti: number
    resMulti: number
    dmgRedMulti: number
    finalDmg: number
    finalTuneStrainMulti: number
    finalTuneBreakZone: number
    customMult: number
    extraRatio: number
    vulnerability: number

    // per hit and total
    rawPerHit: number
    expectedPerHit: number
    totalDamage: number
    totalDamageRaw: number

    // crit/non-crit columns
    nonCritPerHit: number
    critPerHit: number
    canCrit: boolean
    multiplierZones: MultiplierZone[]
}

export interface CharSummary {
    character: string
    totalDamage: number
    entryCount: number
}

export interface SubstatContribution {
    type: string
    value: number
    unit: string
    contributionNorm: number
    contributionRig: number
    contribPctNorm: number
    contribPctRig: number
}

export interface EchoContribution {
    cost: number
    mainStat: string
    substats: SubstatContribution[]
    totalNorm: number
    totalRig: number
    totalPctNorm: number
    totalPctRig: number
}

export interface CharSubstatAnalysis {
    character: string
    totalDamageNorm: number
    totalDamageRig: number
    substatTotalNorm: number
    substatTotalRig: number
    substatTotalPctNorm: number
    substatTotalPctRig: number
    echoes: EchoContribution[]
    aggregated: SubstatContribution[]
}
