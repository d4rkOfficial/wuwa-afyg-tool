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
    vulnerability: number

    // per hit and total
    rawPerHit: number
    expectedPerHit: number
    totalDamage: number

    // new: crit/non-crit columns
    nonCritPerHit: number
    critPerHit: number
    multiplierZones: MultiplierZone[]
}

export interface CharSummary {
    character: string
    totalDamage: number
    entryCount: number
}
