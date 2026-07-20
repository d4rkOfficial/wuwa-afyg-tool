<script lang="ts">
    import { onMount } from 'svelte'
    import { getUiBtnIcons } from '$lib/data/api'

    let activeBox = $state(0)
    let icons = $state<Record<string, string>>({})
    let loaded = $state(false)
    let boxEls: HTMLDivElement[] = []

    const KEY_MAP: Record<string, string> = {
        q: 'Q',
        Q: 'Q',
        e: 'E',
        E: 'E',
        r: 'R',
        R: 'R',
        t: 'T',
        T: 'T',
        f: 'F',
        F: 'F',
        ' ': 'SpaceBar'
    }

    onMount(async () => {
        const data = await getUiBtnIcons()
        for (const [name, url] of Object.entries(data)) {
            icons[name] = url
        }
        loaded = true
        boxEls[0]?.focus()
    })

    const insertIconAtCursor = (name: string) => {
        const el = boxEls[activeBox]
        const url = icons[name]
        if (!el || !url) return

        const img = document.createElement('img')
        img.src = url
        img.alt = name
        img.className = 'inline-block size-8 object-contain align-middle mr-0.5'
        img.draggable = false

        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0)
            range.deleteContents()
            range.insertNode(img)
            range.setStartAfter(img)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
        } else {
            el.appendChild(img)
        }

        el.scrollTop = el.scrollHeight
    }

    const appendIcon = (name: string) => {
        const el = boxEls[activeBox]
        const url = icons[name]
        if (!el || !url) return

        const img = document.createElement('img')
        img.src = url
        img.alt = name
        img.className = 'inline-block size-8 object-contain align-middle mr-0.5'
        img.draggable = false

        el.appendChild(img)
        el.scrollTop = el.scrollHeight
    }

    const handleKeydown = (e: KeyboardEvent) => {
        const key = e.key
        if (key === 'ArrowDown') {
            e.preventDefault()
            activeBox = Math.min(activeBox + 1, 2)
            boxEls[activeBox]?.focus()
            return
        }
        if (key === 'ArrowUp') {
            e.preventDefault()
            activeBox = Math.max(activeBox - 1, 0)
            boxEls[activeBox]?.focus()
            return
        }
        const iconName = KEY_MAP[key]
        if (iconName) {
            e.preventDefault()
            insertIconAtCursor(iconName)
        }
    }

    const handleMousedown = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('header')) return
        if (e.button === 2) {
            appendIcon('MouseRight')
            return
        }
        if (e.button === 1) {
            appendIcon('MouseMiddle')
            return
        }
        if (e.button === 0) {
            appendIcon('MouseLeft')
        }
    }

    const handleContextmenu = (e: MouseEvent) => {
        e.preventDefault()
        appendIcon('MouseRight')
    }
</script>

<svelte:window onkeydown={handleKeydown} onmousedown={handleMousedown} oncontextmenu={handleContextmenu} />

<div class="h-dvh bg-zinc-950 text-zinc-100 flex flex-col">
    <header class="shrink-0 h-12 flex items-center gap-3 px-5 border-b border-zinc-800/50">
        <h1 class="text-sm font-semibold">按键测试</h1>
        <div class="flex items-center gap-2 text-[11px] text-zinc-500">
            {#each ['框1', '框2', '框3'] as label, i}
                <button
                    class="px-2 py-0.5 rounded transition-colors {i === activeBox
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'hover:text-zinc-300'}"
                    onclick={() => {
                        activeBox = i
                        boxEls[i]?.focus()
                    }}>{label}</button
                >
            {/each}
        </div>
        <div class="ml-auto text-[11px] text-zinc-600">
            {#if loaded}
                <span>↑↓ 切换框，Q/E/R/T/F/空格/鼠标输入图标</span>
            {:else}
                <span>加载图标中...</span>
            {/if}
        </div>
    </header>

    <div class="flex-1 grid grid-rows-3 gap-px p-px min-h-0">
        {#each [0, 1, 2] as idx}
            <div
                bind:this={boxEls[idx]}
                contenteditable="true"
                class="overflow-y-auto rounded-lg border bg-zinc-900/60 p-3 text-xs leading-relaxed outline-none transition-colors {activeBox ===
                idx
                    ? 'border-blue-500/50'
                    : 'border-zinc-800'} focus:border-blue-500/50"
                role="textbox"
                tabindex="-1"
                onfocus={() => (activeBox = idx)}
            ></div>
        {/each}
    </div>
</div>
