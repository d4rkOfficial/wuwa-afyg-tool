const SHORT_NAME_MAP: Record<string, string> = {
    '漂泊者·衍射': '光主',
    '漂泊者·湮灭': '暗主',
    '漂泊者·气动': '风主',
    '漂泊者·导电': '雷主',
    '漂泊者·热熔': '火主',
    '漂泊者·冷凝': '冰主'
}

export function shortName(name: string): string {
    if (SHORT_NAME_MAP[name]) return SHORT_NAME_MAP[name]
    if (name.length === 4) return name.slice(0, 2)
    if (name.includes('·')) return name.split('·')[1]
    return name
}
