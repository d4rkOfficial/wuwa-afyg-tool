export interface ResultEntry {
    id: string
    character: string
    hitName: string
    skillType: string
    element: string
    ratioNum: number
    hits: number
    time: number

    // computed
    baseValue: number
    baseUnit: string
    totalMultiplier: number
    baseAtk: number
    totalAtk: number
    atkPctSum: number
    atkFlatSum: number
    totalHp: number
    hpPctSum: number
    hpFlatSum: number
    totalDef: number
    defPctSum: number
    defFlatSum: number
    totalTune: number
    dmgBonus: number
    deepen: number
    critRate: number
    critDmg: number
    defMulti: number
    resMulti: number
    dmgRedMulti: number
    finalDmg: number
    finalHarmony: number
    customMult: number
    vulnerability: number

    // per hit and total
    rawPerHit: number
    expectedPerHit: number
    totalDamage: number
}

export interface CharSummary {
    character: string
    totalDamage: number
    entryCount: number
}
