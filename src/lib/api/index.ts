// lib/api 顶层仅暴露：规范化契约类型、provider 无关常量、通用响应工具、
// 以及数据适配器注册表/getProvider。上游专属的抓取/转换细节封装在 provider/* 内。

export * from './consts'
export * from './types'
export * from './fetch'
export * from './provider'
