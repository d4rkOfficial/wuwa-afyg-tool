// 彩蛋状态：短时间内连续点击主页版本号 badge 5 次解锁「萌萌人工具箱」。
// 解锁后 sidebar / 主页标题与图标切换为 egg 形象；仅会话内生效，不持久化。
// 注意：不写 localStorage——刷新页面即恢复常规形态（彩蛋是一次会话内的惊喜）。
let _eggMode = $state(false)

export function getEggMode(): boolean {
    return _eggMode
}

export function setEggMode(v: boolean): void {
    _eggMode = v
}

/** 彩蛋形态的品牌名与图标 URL（常规形态返回 null，由调用方使用默认 favicon/名称）。 */
export function getEggBranding(): { title: string; icon: string } | null {
    if (!_eggMode) return null
    return { title: '萌萌人工具箱', icon: '/icons/egg/yaya.png' }
}
