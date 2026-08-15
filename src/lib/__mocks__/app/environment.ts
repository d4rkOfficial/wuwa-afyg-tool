// Vitest 下用到的 $app/environment mock。测试以 server 端（browser=false）为准，
// 这样 provider 内的 localStorage/hash 分支都不触发，便于纯净地测抓取与转换。
export const browser = false
export const building = false
export const dev = false
export const version = '0.0.1'
