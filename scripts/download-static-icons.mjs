import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const staticDir = join(root, 'static', 'icons')

const ASSET_BASE = 'https://static.nanoka.cc/assets/ww'
const UI_BTN_BASE = `${ASSET_BASE}/UIResources/Common/Image/UiIconPcBtn`

async function download(url, dest) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    console.log(`  ✓ ${dest}`)
}

async function downloadOrSkip(url, dest) {
    try {
        await download(url, dest)
    } catch (e) {
        console.warn(`  ✗ skipped: ${dest} (${e.message})`)
    }
}

async function downloadAny(urls, dest) {
    for (const url of urls) {
        try {
            await download(url, dest)
            return
        } catch {
            /* try next alias */
        }
    }
    console.warn(`  ✗ skipped: ${dest}`)
}

async function main() {
    console.log('Downloading static icons from nanoka CDN...\n')

    // ── Element icons (6) ──
    const elements = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']
    const elementSetIds = [1, 2, 3, 4, 5, 6]
    console.log('[element]')
    const sonata = await (await fetch(`${ASSET_BASE.replace('/assets/ww', '/ww/3.5')}/sonata.json`)).json()
    for (let i = 0; i < elements.length; i++) {
        const sid = elementSetIds[i]
        const iconPath = sonata[String(sid)]?.icon
        if (iconPath) {
            const stripped = iconPath.replace('/Game/Aki/UI', '').split('.')[0]
            const url = `${ASSET_BASE}${stripped}.webp`
            await download(url, join(staticDir, 'element', `${elements[i]}.webp`))
        }
    }

    // ── Weapon type icons (5) ──
    const weaponTypes = [
        ['长刃', `${ASSET_BASE}/Static/SP_IconNorSword.webp`],
        ['迅刀', `${ASSET_BASE}/Static/SP_IconNorKnife.webp`],
        ['佩枪', `${ASSET_BASE}/Static/SP_IconNorGun.webp`],
        ['臂铠', `${ASSET_BASE}/Static/SP_IconNorFist.webp`],
        ['音感仪', `${ASSET_BASE}/Static/SP_IconNorMagic.webp`]
    ]
    console.log('[weapon-type]')
    for (const [name, url] of weaponTypes) {
        await download(url, join(staticDir, 'weapon-type', `${name}.webp`))
    }

    // ── UI button icons (9) ──
    const buttons = [
        ['MouseLeft', `${UI_BTN_BASE}/T_IconPcBtn_MouseLeft_UI.webp`],
        ['MouseRight', `${UI_BTN_BASE}/T_IconPcBtn_MouseRight_UI.webp`],
        ['Q', `${UI_BTN_BASE}/T_IconPcBtn_KeyQ_UI.webp`],
        ['E', `${UI_BTN_BASE}/T_IconPcBtn_KeyE_UI.webp`],
        ['R', `${UI_BTN_BASE}/T_IconPcBtn_KeyR_UI.webp`],
        ['F', `${UI_BTN_BASE}/T_IconPcBtn_KeyF_UI.webp`],
        ['T', `${UI_BTN_BASE}/T_IconPcBtn_KeyT_UI.webp`],
        ['SpaceBar', `${UI_BTN_BASE}/T_IconPcBtn_KeySpaceBar_UI.webp`],
        ['MouseMiddle', `${UI_BTN_BASE}/T_IconPcBtn_MouseMiddle_UI.webp`]
    ]
    console.log('[btn]')
    for (const [name, url] of buttons) {
        await download(url, join(staticDir, 'btn', `${name}.webp`))
    }

    // ── Keyboard key icons (digits / letters / named keys) ──
    console.log('[key]')
    const keys = []
    for (let i = 0; i <= 9; i++) keys.push([String(i), `T_IconPcBtn_Key${i}_UI.webp`])
    for (let i = 0; i < 26; i++) {
        const c = String.fromCharCode(65 + i)
        keys.push([c, `T_IconPcBtn_Key${c}_UI.webp`])
    }
    const named = [
        'Esc',
        'Tab',
        'CapsLock',
        'LeftShift',
        'RightShift',
        'LeftCtrl',
        'RightCtrl',
        'LeftAlt',
        'RightAlt',
        'Enter',
        'Delete',
        'Up',
        'Down',
        'Left',
        'Right'
    ]
    for (const name of named) keys.push([name, `T_IconPcBtn_Key${name}_UI.webp`])
    for (const [name, file] of keys) {
        await downloadOrSkip(`${UI_BTN_BASE}/${file}`, join(staticDir, 'btn', `${name}.webp`))
    }
    // Backspace uses an alias on the CDN
    await downloadAny(
        [
            `${UI_BTN_BASE}/T_IconPcBtn_KeyBackSpace_UI.webp`,
            `${UI_BTN_BASE}/T_IconPcBtn_KeyBackspace_UI.webp`,
            `${UI_BTN_BASE}/T_IconPcBtn_KeyBack_UI.webp`
        ],
        join(staticDir, 'btn', 'Backspace.webp')
    )

    console.log('\nDone!')
}

main().catch((e) => {
    console.error('Failed:', e)
    process.exit(1)
})
