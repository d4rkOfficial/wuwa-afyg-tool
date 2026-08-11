// WS 远程接管示例服务端（零依赖，Node 原生 http upgrade + 手写最小 ws 帧编解码）
// 用法：node scripts/ws-demo-server.mjs [port]（默认 8765）
// 客户端：打开 http://localhost:5173/#websocket=127.0.0.1:8765
// 交互命令（终端输入）：
//   exec <tool> <json>   下发工具调用，如 exec list_projects {} / exec set_chain {"slot":1,"value":3}
//   hello                打印客户端握手信息（工具清单/初始状态）
//   tools                打印工具清单（名称）
//   state                查看最近收到的状态推送
//   exit                 退出
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import readline from 'node:readline'

const port = Number(process.argv[2] || 8765)

let sockets = []
let lastHello = null
let lastState = null

// ── 最小 WebSocket 帧编解码（文本帧，无分片）──

function encodeTextFrame(text) {
    const payload = Buffer.from(text, 'utf8')
    const len = payload.length
    let header
    if (len < 126) {
        header = Buffer.from([0x81, len])
    } else if (len < 65536) {
        header = Buffer.alloc(4)
        header[0] = 0x81
        header[1] = 126
        header.writeUInt16BE(len, 2)
    } else {
        header = Buffer.alloc(10)
        header[0] = 0x81
        header[1] = 127
        header.writeBigUInt64BE(BigInt(len), 2)
    }
    return Buffer.concat([header, payload])
}

function decodeFrame(buf) {
    // 仅处理单帧文本消息（浏览器对小块 send 不会分片）
    const opcode = buf[0] & 0x0f
    const masked = (buf[1] & 0x80) !== 0
    let len = buf[1] & 0x7f
    let offset = 2
    if (len === 126) {
        len = buf.readUInt16BE(2)
        offset = 4
    } else if (len === 127) {
        len = Number(buf.readBigUInt64BE(2))
        offset = 10
    }
    if (opcode !== 1 || !masked || buf.length < offset + 4 + len) return null
    const mask = buf.subarray(offset, offset + 4)
    offset += 4
    const payload = Buffer.alloc(len)
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i % 4]
    return payload.toString('utf8')
}

// ── 消息处理 ──

function send(sock, msg) {
    if (sock && sock.writable) sock.write(encodeTextFrame(JSON.stringify(msg)))
}

function handleMessage(sock, raw) {
    let msg
    try {
        msg = JSON.parse(raw)
    } catch {
        return
    }
    if (msg.type === 'hello') {
        lastHello = msg
        console.log(`\n[hello] 客户端：${msg.app} v${msg.version ?? '?'}`)
        console.log(`[hello] 可用工具 ${msg.tools?.length ?? 0} 个`)
        console.log(`[hello] 初始状态：${JSON.stringify(msg.state)}`)
    } else if (msg.type === 'state') {
        lastState = msg.state
        console.log(`[state] ${JSON.stringify(msg.state)}`)
    } else if (msg.type === 'result') {
        console.log(`[result #${msg.id}] ${JSON.stringify(msg)}`)
    } else if (msg.type === 'progress') {
        console.log(`[progress] ${msg.text}`)
    } else if (msg.type === 'ping') {
        send(sock, { type: 'pong' })
    } else if (msg.type === 'pong') {
        console.log('[pong]')
    }
}

// ── 服务器 ──

const server = createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' })
    res.end('upgrade required: 本服务仅接受 WebSocket 连接')
})

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (!key) {
        socket.destroy()
        return
    }
    const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    console.log(`[连接] ${req.socket.remoteAddress}`)

    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
            if (buffer.length < 2) break
            let text = decodeFrame(buffer)
            if (text === null) break
            handleMessage(socket, text)
            buffer = buffer.subarray(frameLength(buffer))
        }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
        sockets = sockets.filter((s) => s !== socket)
        console.log(`[连接关闭] 剩余 ${sockets.length} 个连接`)
    })
    sockets.push(socket)
})

function frameLength(buf) {
    let len = buf[1] & 0x7f
    let offset = 2
    if (len === 126) {
        len = buf.readUInt16BE(2)
        offset = 4
    } else if (len === 127) {
        len = Number(buf.readBigUInt64BE(2))
        offset = 10
    }
    return offset + 4 + len
}

// ── 交互命令 ──

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function prompt() {
    rl.prompt()
}

rl.on('line', (line) => {
    const input = line.trim()
    if (!input) return prompt()
    const [cmd, ...rest] = input.split(/\s+/)
    if (cmd === 'exit') {
        process.exit(0)
    } else if (cmd === 'tools') {
        const tools = lastHello?.tools ?? []
        console.log(tools.map((t) => t.function.name).join('\n'))
    } else if (cmd === 'hello') {
        if (lastHello) {
            console.log(JSON.stringify({ ...lastHello, tools: lastHello.tools?.map((t) => t.function.name) }, null, 2))
        } else {
            console.log('尚未收到客户端 hello（等待连接中）')
        }
    } else if (cmd === 'state') {
        console.log(JSON.stringify(lastState, null, 2))
    } else if (cmd === 'exec') {
        const tool = rest[0]
        let args = {}
        const argsText = rest.slice(1).join(' ')
        try {
            args = argsText ? JSON.parse(argsText) : {}
        } catch {
            console.log('参数不是合法 JSON')
            return prompt()
        }
        if (!tool) {
            console.log('用法：exec <tool> <json>')
            return prompt()
        }
        if (sockets.length === 0) {
            console.log('没有已连接的客户端')
            return prompt()
        }
        const id = String(Date.now())
        console.log(`[下发 exec #${id}] ${tool} ${JSON.stringify(args)}`)
        for (const s of sockets) send(s, { type: 'exec', id, tool, args })
    } else {
        console.log(`未知命令：${cmd}（可用：exec/tools/hello/state/exit）`)
    }
    prompt()
})

server.listen(port, () => {
    console.log(`WS 示例服务端已启动：ws://127.0.0.1:${port}`)
    console.log(`打开应用：http://localhost:5173/#websocket=127.0.0.1:${port}`)
    prompt()
})
