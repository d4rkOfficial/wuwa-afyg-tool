const SHORT_NAME_MAP: Record<string, string> = {
    '漂泊者·衍射': '光主',
    '漂泊者·湮灭': '暗主',
    '漂泊者·气动': '风主',
    '漂泊者·导电': '雷主',
    '漂泊者·热熔': '火主',
    '漂泊者·冷凝': '冰主',
    // Brant, nb!
    布兰特: '船长'
}

/** @desc 角色短名：别名表优先；4 字名若去掉「·」后正好剩 3 字（如「陆·赫斯」→「陆赫斯」），直接取去掉「·」的名字 */
export const shortName = (name: string): string => {
    if (SHORT_NAME_MAP[name]) return SHORT_NAME_MAP[name]
    const stripped = name.split('·').join('')
    if (name.length === 4 && stripped.length === 3) return stripped
    if (name.length === 4) return name.slice(0, 2)
    if (name.includes('·')) return name.split('·')[1]
    return name
}
