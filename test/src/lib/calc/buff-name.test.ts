// 全名工具：反斜杠分隔、短名/文件夹名允许 /、禁止 \。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    buffFolderPath,
    buffLeafName,
    clampBuffPathName,
    joinBuffPath,
    sanitizeLeafName,
    splitBuffPath
} from '$lib/calc/buff-name'

describe('Buff 全名', () => {
    it('拆分 / 拼接 / 取短名', () => {
        assert.deepEqual(splitBuffPath('A\\B\\1层'), ['A', 'B', '1层'])
        assert.equal(buffLeafName('A\\B\\1层'), '1层')
        assert.equal(buffLeafName('根Buff'), '根Buff')
        assert.deepEqual(buffFolderPath('A\\B\\1层'), ['A', 'B'])
        assert.deepEqual(buffFolderPath('根Buff'), [])
        assert.equal(joinBuffPath('A', 'B', '1层'), 'A\\B\\1层')
        assert.equal(joinBuffPath(null, 'A', '', 'B'), 'A\\B')
    })

    it('叶子名允许 /、禁止 \\；超层压平', () => {
        assert.equal(sanitizeLeafName('  A/B  '), 'A/B')
        assert.equal(sanitizeLeafName('A\\B'), 'A/B')
        assert.equal(clampBuffPathName('A\\B\\C\\buff', 2), 'A\\B\\C/buff')
        assert.equal(clampBuffPathName('A\\buff', 2), 'A\\buff')
    })
})
