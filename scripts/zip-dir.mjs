/**
 * @desc 零依赖的「目录 → zip」写入器（只用 node:zlib 的 deflateRaw + 自算 CRC32）。
 *
 * 为什么不用 Compress-Archive / zip 命令：`pnpm run package:standalone` 要在 Windows、macOS、CI
 * 上给出同一个产物，而这几条路线各自的 UTF-8 文件名处理、是否默认带目录项、能否离线都不同。
 * 这里只产出最小合法 zip（无目录项、文件名 UTF-8 + 通用标志位 11），Windows 资源管理器、
 * macOS 归档工具、unzip / 7-Zip 都能直接解。
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

const crc32 = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

/** @desc MS-DOS 时间/日期（zip 头里只有这两项，秒数精度 2 秒） */
const dosStamp = (mtime) => ({
    time: ((mtime.getHours() << 11) | (mtime.getMinutes() << 5) | Math.floor(mtime.getSeconds() / 2)) & 0xffff,
    date: (((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate()) & 0xffff
})

/** @desc 递归收集文件（顺序稳定：按 zip 内相对路径排序，便于产物比对） */
const collectFiles = (root) => {
    const out = []
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const abs = join(dir, entry.name)
            if (entry.isDirectory()) walk(abs)
            else if (entry.isFile()) out.push(abs)
        }
    }
    walk(root)
    const nameOf = (abs) => relative(root, abs).split(sep).join('/')
    return out.map((abs) => ({ abs, name: nameOf(abs) })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @desc 把 root 目录下的所有文件打进 zipPath（zip 内路径相对 root，不带顶层目录名）。
 * @returns {{ files: number, rawBytes: number, zipBytes: number }}
 */
export const zipDirectory = (zipPath, root) => {
    const files = collectFiles(root)
    const localParts = []
    const centralParts = []
    let offset = 0
    let rawBytes = 0

    for (const file of files) {
        const data = readFileSync(file.abs)
        const mtime = statSync(file.abs).mtime
        const stamp = dosStamp(mtime)
        const crc = crc32(data)
        const deflated = deflateRawSync(data, { level: 9 })
        const useDeflate = deflated.length < data.length
        const body = useDeflate ? deflated : data
        const nameBuf = Buffer.from(file.name, 'utf8')

        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4) // version needed
        local.writeUInt16LE(0x0800, 6) // 通用标志位：文件名是 UTF-8
        local.writeUInt16LE(useDeflate ? 8 : 0, 8) // 压缩方法
        local.writeUInt16LE(stamp.time, 10)
        local.writeUInt16LE(stamp.date, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26)
        local.writeUInt16LE(0, 28) // extra 长度

        localParts.push(local, nameBuf, body)

        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE(20, 4) // version made by
        central.writeUInt16LE(20, 6) // version needed
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(useDeflate ? 8 : 0, 10)
        central.writeUInt16LE(stamp.time, 12)
        central.writeUInt16LE(stamp.date, 14)
        central.writeUInt32LE(crc, 16)
        central.writeUInt32LE(body.length, 20)
        central.writeUInt32LE(data.length, 24)
        central.writeUInt16LE(nameBuf.length, 28)
        central.writeUInt16LE(0, 30) // extra
        central.writeUInt16LE(0, 32) // comment
        central.writeUInt16LE(0, 34) // disk number
        central.writeUInt16LE(0, 36) // internal attrs
        central.writeUInt32LE(0, 38) // external attrs
        central.writeUInt32LE(offset, 42)
        centralParts.push(central, nameBuf)

        offset += local.length + nameBuf.length + body.length
        rawBytes += data.length
    }

    const centralBuf = Buffer.concat(centralParts)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4) // disk
    end.writeUInt16LE(0, 6) // central dir disk
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(centralBuf.length, 12)
    end.writeUInt32LE(offset, 16)
    end.writeUInt16LE(0, 20) // comment 长度

    const zip = Buffer.concat([...localParts, centralBuf, end])
    mkdirSync(dirname(zipPath), { recursive: true })
    writeFileSync(zipPath, zip)
    return { files: files.length, rawBytes, zipBytes: zip.length }
}
