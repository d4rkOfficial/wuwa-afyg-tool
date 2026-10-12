// 回归：IndexedDB 落盘必须先把 Svelte `$state`（= Proxy）转成结构化克隆安全的纯值。
//
// 历史 bug：`$state` 读出来的一切对象/数组都是 Proxy，结构化克隆（`indexedDB.put` 与
// `structuredClone` 同一套算法）明确拒绝 Proxy → `DataCloneError` 被 `dbSet` 的 try/catch 吞掉，
// 表现就是「设置改了、退出重进就丢」（实测受影响：工坊/分享源、按键图标、快捷键位、AI 助手偏好）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toStorable } from '$lib/data/db'

/** @desc 模拟 Svelte 5 `$state` 读出的值：任何对象/数组都是 Proxy（实测 `$.state($.proxy(v))`） */
const asState = <T extends object>(value: T): T => new Proxy(value, {})

describe('toStorable：落盘前的结构化克隆安全转换', () => {
    it('原始 Proxy 本身确实无法结构化克隆（这就是 bug 的根因）', () => {
        assert.throws(() => structuredClone(asState({ a: 1 })), { name: 'DataCloneError' })
        assert.throws(() => structuredClone(asState([1, 2])), { name: 'DataCloneError' })
    })

    it('Proxy 对象 / 数组转换后可克隆且内容一致', () => {
        const src = asState({ instances: [{ id: 'ws-0', url: 'https://a.example' }], activeId: 'ws-0' })
        const out = toStorable(src)
        assert.deepEqual(structuredClone(out), {
            instances: [{ id: 'ws-0', url: 'https://a.example' }],
            activeId: 'ws-0'
        })
    })

    it('外层是普通对象、内层是 Proxy（工坊/按键/快捷键的实际形态）也能转换', () => {
        const instances = asState([{ id: 'ws-0', url: 'https://a.example' }])
        const out = toStorable({ instances, activeId: 'ws-0' })
        assert.deepEqual(structuredClone(out), {
            instances: [{ id: 'ws-0', url: 'https://a.example' }],
            activeId: 'ws-0'
        })
    })

    it('普通数据原样保留（走保真的 structuredClone 分支）', () => {
        const at = new Date(0)
        const out = toStorable({ at, list: [1, '二', null, true] }) as { at: Date; list: unknown[] }
        assert.deepEqual(out, { at, list: [1, '二', null, true] })
        assert.ok(out.at instanceof Date)
    })

    it('基础值照常通过（含 clear 用的 undefined）', () => {
        assert.equal(toStorable(undefined), undefined)
        assert.equal(toStorable(null), null)
        assert.equal(toStorable('top-left'), 'top-left')
        assert.equal(toStorable(0), 0)
    })
})
