// @desc 批量 AI 改写工坊数据库 weapon/character 的 Buff 名（紧凑风格），支持直写 Supabase buff_sets 表
// 用法：
//   node scripts/rename-weapon-character-buffs.mjs --api-key <key>          # 仅 dry-run，产出报告
//   node scripts/rename-weapon-character-buffs.mjs --api-key <key> --write  # 校验后直写工坊库
// 参数：
//   --api-key <key>          AI key（默认取 env OPENCODE_GO_KEY / DEEPSEEK_API_KEY）
//   --base-url <url>         默认 https://opencode.ai/zen/go/v1
//   --model <name>           默认 deepseek-v4-flash
//   --source <url>           工坊 buff-sets API（默认 https://wuwa-afyg-share.200503.xyz/api/buff-sets）
//   --share-dir <path>       share 仓库目录（读取 .env.local 的 Supabase 配置；默认 ../wuwa-afyg-share）
//   --out <dir>              输出目录（默认 <cwd>/rename-output）
//   --write                  校验通过后写入工坊数据库（默认只 dry-run）
//   --only <type>            只处理 character / weapon
//   --offset <n> / --limit <n>  按实体序号范围处理（断点续跑）
//   --resume                 从上次进度文件继续
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

// ── 风格规范（用户确认） ──────────────────────────────────────
const STYLE_RULES = `把武器/角色的 Buff 名改写成「紧凑风格」，规则如下：

1. 归属者写法：
   - 武器：用全名（如「万物持存的注释」），阶数放末尾（如「 1阶」「 5阶」）。
   - 角色：用玩家黑话短名（如 散华→散、长离→离、卡卡罗→卡、维里奈→维），链数紧跟短名放开头（如「散6链」「卡4链」）；短名未定的角色由你拟一个 1-2 字简称。
2. 触发条件：保留但简写，动作后带「时」或「后」（施放X→X时，达成Y→Y后）；「延奏」作为动作时不带时/后（如「延奏」本身，或「延奏登场」）。
3. 常驻/无条件增益：省略触发段，直接写效果。
4. 效果词条保留原语义与写法：乘区（攻击/暴击率/暴击伤害/增伤(属性)/加深(类型)/无视防御/穿防/倍率提升…）、全队+/队友+ 前缀、层数（N层）均保留。
5. 名字里必须能看出：谁（短名/武器全名）、什么条件触发（如有）、加什么。
6. 只改名字，不改任何数值。`

const FEW_SHOT = `参考改写示例（武器→武器全名+效果+阶放末尾，常驻省略触发）：
- [万物持存的注释[1阶]]<常驻>攻击 → 万物持存的注释 攻击 1阶
- [万物持存的注释[1阶]]<施放变奏技能或共鸣解放时>增伤(共鸣解放) → 万物持存的注释 变奏/共鸣解放时 增伤(共鸣解放) 1阶
- [万物持存的注释[1阶]]<施放变奏技能时>无视防御5层 → 万物持存的注释 施放变奏时 无视防御5层 1阶
- [万物持存的注释[1阶]]<自身获得护盾时>无视防御1层 → 万物持存的注释 获得护盾时 无视防御1层 1阶

角色示例（角色→黑话短名+链放开头+触发+效果，常驻省略触发）：
- [散华]<常驻>攻击 → 散 攻击
- [散华]<施放第5段普攻>增伤(冰绽) → 散 第5段普攻后 增伤(冰绽)
- [散华]<施放延奏,下一位登场>队友+加深(普攻) → 散 延奏登场 队友+加深(普攻)
- [散华[6链]]<引爆冰棱或冰川>全队+攻击1层 → 散6链 引爆冰棱/冰川后 全队+攻击1层
- [卡卡罗[4链]]<施放延奏>全队+增伤(导电) → 卡4链 延奏 全队+增伤(导电)
- [卡卡罗]<施放重击仁慈>增伤(共鸣解放) → 卡 重击仁慈后 增伤(共鸣解放)`

const KNOWN_SHORT_NAMES = '已知角色短名：散华→散、长离→离、卡卡罗→卡、维里奈→维；其它角色由你拟 1-2 字简称。'

// ── 参数解析 ─────────────────────────────────────────────────
function parseArgs(argv) {
    const args = { baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash' }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        const next = () => argv[++i]
        if (a === '--api-key') args.apiKey = next()
        else if (a === '--base-url') args.baseUrl = next()
        else if (a === '--model') args.model = next()
        else if (a === '--source') args.source = next()
        else if (a === '--share-dir') args.shareDir = next()
        else if (a === '--out') args.out = next()
        else if (a === '--only') args.only = next()
        else if (a === '--offset') args.offset = Number(next())
        else if (a === '--limit') args.limit = Number(next())
        else if (a === '--write') args.write = true
        else if (a === '--resume') args.resume = true
        else if (a === '--sql') args.sql = next()
        else {
            console.error(`未知参数：${a}`)
            process.exit(1)
        }
    }
    return args
}

// ── 工具函数 ─────────────────────────────────────────────────
// 旧风格：[名] 或 [名[N链/阶]] 开头，后接 <触发>效果
const OLD_FORMAT_RE = /^\[[^\[\]]*(\[[^\[\]]*\])?\]<.+/

function isOldFormat(name) {
    return OLD_FORMAT_RE.test(name)
}

function groupEntities(rows) {
    const map = new Map()
    for (const r of rows) {
        if (r.entity_type !== 'character' && r.entity_type !== 'weapon') continue
        if (!isOldFormat(r.buff_name)) continue
        const key = `${r.entity_type}/${r.entity_name}`
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(r)
    }
    return [...map.entries()]
}

async function fetchBuffSets(source) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
    const json = await res.json()
    return json.buffSets ?? []
}

// ── AI 改写 ──────────────────────────────────────────────────
async function aiRenameEntity({ apiKey, baseUrl, model }, entityType, entityName, buffs) {
    const oldNames = buffs.map((b) => b.buff_name)
    const list = oldNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
    const messages = [
        {
            role: 'system',
            content: `你是鸣潮工具站的 Buff 命名助手。${STYLE_RULES}\n\n${FEW_SHOT}\n\n${KNOWN_SHORT_NAMES}\n\n必须只输出 JSON：{"shortName":"角色短名(仅character需要,weapon留空)","renames":[{"old":"原样完整的旧名","new":"新名"},...]}。renames 数量必须与输入一致，old 必须逐字等于输入，new 不重复且不能为空。`
        },
        {
            role: 'user',
            content: `实体类型：${entityType}\n实体名：${entityName}\n以下为该实体全部 Buff 名（每行一条），请按规则改写：\n${list}`
        }
    ]
    const body = {
        model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
    }
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`AI HTTP ${res.status}：${text.slice(0, 200)}`)
    }
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed?.renames)) throw new Error('AI 返回缺少 renames 数组')

    const byOld = new Map(oldNames.map((n) => [n, n]))
    const renames = []
    const seen = new Set()
    for (const item of parsed.renames) {
        const old = typeof item?.old === 'string' ? item.old.trim() : ''
        const fresh = typeof item?.new === 'string' ? item.new.trim() : ''
        if (!byOld.has(old)) throw new Error(`AI 返回了未知的 old：${old}`)
        if (!fresh) throw new Error(`新名为空：${old}`)
        if (seen.has(fresh)) throw new Error(`新名重复：${fresh}`)
        seen.add(fresh)
        renames.push({ old, new: fresh })
    }
    if (renames.length !== oldNames.length) {
        throw new Error(`数量不符：输入 ${oldNames.length} 条，返回 ${renames.length} 条`)
    }
    return {
        shortName: typeof parsed.shortName === 'string' ? parsed.shortName.trim() : '',
        renames
    }
}

// ── Supabase 写入 ────────────────────────────────────────────
function loadShareEnv(shareDir) {
    const envFile = path.join(shareDir, '.env.local')
    if (!fs.existsSync(envFile)) return null
    const env = {}
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
    return env
}

async function renameRowInSupabase(env, row, newName) {
    const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')
    const qs = new URLSearchParams({
        entity_type: `eq.${row.entity_type}`,
        entity_name: `eq.${row.entity_name}`,
        buff_name: `eq.${row.buff_name}`
    })
    const res = await fetch(`${base}/rest/v1/buff_sets?${qs}`, {
        method: 'PATCH',
        headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
        },
        body: JSON.stringify({ buff_name: newName })
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`写库失败 HTTP ${res.status}：${text.slice(0, 200)}`)
    }
}

// ── 进度持久化 ───────────────────────────────────────────────
function progressFile(outDir) {
    return path.join(outDir, 'progress.json')
}

function loadProgress(outDir) {
    const f = progressFile(outDir)
    if (fs.existsSync(f)) {
        try {
            return JSON.parse(fs.readFileSync(f, 'utf8'))
        } catch {
            // 忽略损坏进度
        }
    }
    return { done: {}, failed: {} }
}

function saveProgress(outDir, progress) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(progressFile(outDir), JSON.stringify(progress, null, 2))
}

// ── 报告 ─────────────────────────────────────────────────────
function escapeMd(s) {
    return String(s).replace(/\|/g, '\\|')
}

function renderReport({ rows, progress, entities, dryRun, args }) {
    const lines = []
    lines.push(`# Buff 名批量改写报告`)
    lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`)
    lines.push(`- 模式：${dryRun ? 'DRY-RUN（未写入数据库）' : '已写入工坊数据库'}`)
    lines.push(`- 模型：${args.model}（${args.baseUrl}）`)
    lines.push(
        `- 处理实体：${entities.length}（成功 ${Object.keys(progress.done).length} / 失败 ${Object.keys(progress.failed).length}）`
    )
    lines.push('')
    if (Object.keys(progress.failed).length > 0) {
        lines.push(`## 失败实体`)
        for (const [key, err] of Object.entries(progress.failed)) {
            lines.push(`- ${key}：${err}`)
        }
        lines.push('')
    }
    lines.push(`## 全部改动明细`)
    for (const [key, result] of Object.entries(progress.done)) {
        const [et, en] = key.split('/')
        const label = et === 'character' && result.shortName ? `${en}（短名：${result.shortName}）` : en
        lines.push(`### ${label}`)
        lines.push(`| 原名 | 新名 |`)
        lines.push(`| --- | --- |`)
        for (const r of result.renames) {
            lines.push(`| ${escapeMd(r.old)} | ${escapeMd(r.new)} |`)
        }
        lines.push('')
    }
    return lines.join('\n')
}

// 简化 outDir 访问
function outDirOf(args) {
    return path.resolve(args.out ?? path.join(process.cwd(), 'rename-output'))
}

// SQL 字符串转义（单引号加倍）
function sqlStr(s) {
    return String(s).replace(/'/g, "''")
}

// 从 progress.json 生成批量改名 SQL（事务包裹，供 Supabase SQL Editor 手动执行）
function renderRenameSql(progress) {
    const lines = [
        '-- 角色/武器 Buff 名批量改名（共 N 条，由 rename-weapon-character-buffs.mjs 生成）',
        '-- 仅修改 buff_name（主键之一），zones/condition/scope 保持不变',
        'begin;'
    ]
    let total = 0
    for (const [key, result] of Object.entries(progress.done)) {
        const [entityType, entityName] = key.split('/')
        for (const r of result.renames) {
            if (r.new === r.old) continue
            total++
            lines.push(
                `update public.buff_sets set buff_name = '${sqlStr(r.new)}'` +
                    ` where entity_type = '${entityType}' and entity_name = '${sqlStr(entityName)}'` +
                    ` and buff_name = '${sqlStr(r.old)}';`
            )
        }
    }
    lines[0] = `-- 角色/武器 Buff 名批量改名（共 ${total} 条，由 rename-weapon-character-buffs.mjs 生成）`
    lines.push('commit;')
    lines.push('')
    lines.push('-- 验证：应返回 0 行（无残留旧格式方括号名）')
    lines.push('select count(*) as remaining_old_style from public.buff_sets')
    lines.push("  where entity_type in ('character','weapon') and buff_name like '[%'")
    lines.push(';')
    return lines.join('\n') + '\n'
}

function renderShortNameDict(progress) {
    const dict = {}
    for (const [key, result] of Object.entries(progress.done)) {
        if (key.startsWith('character/') && result.shortName) {
            const en = key.split('/')[1]
            dict[en] = result.shortName
        }
    }
    return dict
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
    const args = parseArgs(process.argv.slice(2))
    const outDir = outDirOf(args)

    // --sql 模式：仅从现有 progress.json 生成 SQL，不联网、不需要 API Key
    if (args.sql) {
        const progress = loadProgress(outDir)
        const doneCount = Object.keys(progress.done).length
        if (doneCount === 0) {
            console.error(`未找到进度数据：${progressFile(outDir)}（请先运行 dry-run 生成）`)
            process.exit(1)
        }
        const sql = renderRenameSql(progress)
        fs.writeFileSync(args.sql, sql, 'utf8')
        const lines = sql.split('\n').filter((l) => l.startsWith('update ')).length
        console.log(`已生成 SQL：${args.sql}`)
        console.log(`包含 ${lines} 条 UPDATE，事务包裹，可在 Supabase SQL Editor 执行`)
        return
    }

    const apiKey = args.apiKey ?? process.env.OPENCODE_GO_KEY ?? process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
        console.error('缺少 API Key：请用 --api-key 或设置 OPENCODE_GO_KEY 环境变量')
        process.exit(1)
    }
    if (args.only && args.only !== 'character' && args.only !== 'weapon') {
        console.error('--only 仅支持 character / weapon')
        process.exit(1)
    }
    const source = args.source ?? 'https://wuwa-afyg-share.200503.xyz/api/buff-sets'
    const shareDir = path.resolve(args.shareDir ?? path.join(import.meta.dirname, '..', '..', 'wuwa-afyg-share'))

    console.log(`抓取数据：${source}`)
    const rows = await fetchBuffSets(source)
    const entities = groupEntities(rows)
    console.log(`工坊库共 ${rows.length} 条，其中 weapon/character 旧风格待改 ${entities.length} 个实体`)

    if (args.only) {
        const filtered = entities.filter(([key]) => key.startsWith(args.only))
        console.log(`按 --only ${args.only} 过滤后：${filtered.length} 个实体`)
        entities.length = 0
        entities.push(...filtered)
    }

    let start = args.offset ?? 0
    let end = args.limit ? Math.min(entities.length, start + args.limit) : entities.length
    if (start > 0 || args.limit) {
        console.log(`处理范围：${start + 1} ~ ${end}（共 ${entities.length}）`)
    }

    const progress = args.resume ? loadProgress(outDir) : { done: {}, failed: {} }

    const aiArgs = { apiKey, baseUrl: args.baseUrl, model: args.model }
    for (let i = start; i < end; i++) {
        const [key, buffs] = entities[i]
        const [entityType, entityName] = key.split('/')
        if (progress.done[key] || progress.failed[key]) {
            console.log(`跳过（已完成）：${entityName}`)
            continue
        }
        process.stdout.write(`[${i + 1}/${end}] ${entityType} ${entityName}（${buffs.length} 条）… `)
        let result = null
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                result = await aiRenameEntity(aiArgs, entityType, entityName, buffs)
                break
            } catch (e) {
                if (attempt === 0) {
                    console.log(`\n  第 1 次失败（${e.message}），重试…`)
                    await sleep(1000)
                } else {
                    console.log(`失败：${e.message}`)
                    progress.failed[key] = e.message
                }
            }
        }
        if (result) {
            progress.done[key] = result
            console.log(`✓ ${result.renames.length} 条`)
        }
        saveProgress(outDir, progress)
    }
    saveProgress(outDir, progress)

    // 报告
    const md = renderReport({ rows, progress, entities, dryRun: !args.write, args })
    const reportFile = path.join(outDir, 'rename-report.md')
    fs.writeFileSync(reportFile, md, 'utf8')
    console.log(`\n报告已生成：${reportFile}`)

    const dict = renderShortNameDict(progress)
    console.log(`\n角色短名词典（${Object.keys(dict).length} 个）：`)
    for (const [name, short] of Object.entries(dict)) console.log(`  ${name} → ${short}`)

    if (!args.write) {
        console.log(`\nDRY-RUN 完成（未写库）。审核报告后用 --write 执行写入。`)
        return
    }

    const env = loadShareEnv(shareDir)
    if (!env) {
        console.error(`\n找不到 ${shareDir}/.env.local 或缺少 Supabase 配置，无法写库`)
        process.exit(1)
    }
    console.log(`\n写库目标：${env.NEXT_PUBLIC_SUPABASE_URL}（service role）`)

    let okCount = 0
    let errCount = 0
    for (const [key, result] of Object.entries(progress.done)) {
        const [entityType, entityName] = key.split('/')
        const byOld = new Map(result.renames.map((r) => [r.old, r.new]))
        for (const row of rows) {
            if (row.entity_type !== entityType || row.entity_name !== entityName) continue
            const newName = byOld.get(row.buff_name)
            if (!newName || newName === row.buff_name) continue
            try {
                await renameRowInSupabase(env, row, newName)
                okCount++
            } catch (e) {
                errCount++
                console.error(`  ✗ ${entityName}「${row.buff_name}」→「${newName}」失败：${e.message}`)
            }
        }
    }
    console.log(`\n写库完成：成功 ${okCount} 行，失败 ${errCount} 行`)
    if (errCount > 0) console.log(`失败明细已在上方输出，可 --resume 复查进度文件后重跑 --write。`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
