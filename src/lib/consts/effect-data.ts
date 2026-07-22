export const EFFECT_BASE_VALUE = 3674

const EFFECT_TABLE: Record<string, (number | [number, number])[]> = {
    光噪效应: [
        0.3, 0.5439, 0.7878, 1.0317, 1.2756, 1.5195, 1.7634, 2.0073, 2.2512, 2.4951, 3.3268, 4.1585, 4.9902, 5.8219,
        6.6536, 7.4853, 8.317, 9.1487, 9.9804
    ],
    霜渐效应: [
        0.245, 0.4442, 0.6434, 0.8426, 1.0417, 1.2409, 1.4401, 1.6393, 1.8385, 2.0377, 2.7169, 3.3961, 4.0753, 4.7545,
        5.4337, 6.1129, 6.7921, 7.4713, 8.1505
    ],
    聚爆效应: [
        0.84, 1.5229, 2.2058, 2.8888, 3.5717, 4.2546, 4.9375, 5.6204, 6.3034, 6.9863, 9.315, 11.6438, 13.9726, 16.3014,
        18.6302, 20.959, 23.2878, 25.6166, 27.9454
    ],
    电磁效应: [
        [0.5, 0.5],
        [0.9065, 0.9065],
        [1.313, 1.313],
        [1.7195, 1.7195],
        [2.126, 2.126],
        [2.5325, 2.5325],
        [2.939, 2.939],
        [3.3455, 3.3455],
        [3.752, 3.752],
        [4.1585, 4.1585],
        [5.5447, 5.5447],
        [6.9308, 6.9308],
        [8.317, 8.317],
        [9.7032, 9.7032],
        [11.0894, 11.0894],
        [12.4756, 12.4756],
        [13.8618, 13.8618],
        [15.248, 15.248],
        [16.6342, 16.6342]
    ],
    风蚀效应: [0.45, 1.125, 2.25, 3.375, 4.5, 5.625, 6.75, 7.875, 9.0, 10.125, 11.25, 12.375]
}

export function getEffectMultiplier(name: string, layers: number): number {
    const data = EFFECT_TABLE[name]
    if (!data || layers < 1 || layers > data.length) return 0
    const entry = data[layers - 1]
    if (Array.isArray(entry)) return entry[0]
    return entry
}

export function getEffectBurstMultiplier(name: string, layers: number): number {
    const data = EFFECT_TABLE[name]
    if (!data || layers < 1 || layers > data.length) return 0
    const entry = data[layers - 1]
    if (Array.isArray(entry)) return entry[1]
    return 0
}

export function hasEffectDamage(name: string): boolean {
    return name in EFFECT_TABLE
}
