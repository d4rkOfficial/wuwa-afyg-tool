<script lang="ts">
    /**
     * @desc Buff 集路径式名称输入：单行 contenteditable，文件夹段加粗、`\` 淡化、叶子正常。
     * 只负责“显示富文本 + 提交时纠正”；文件夹结构由父组件按全名重新派生。
     * 工坊 / 工具箱 Buff 集最多一层文件夹（工程内 Buff 树不使用本组件）。
     */
    import { onMount } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        value: string
        oncommit: (value: string) => void
        placeholder?: string
    }

    let { value, oncommit, placeholder = '文件夹\\Buff名', class: className, style: styleProp }: Props = $props()

    let el = $state<HTMLDivElement | null>(null)
    let composing = false
    let focused = false

    /** @desc Buff 集路径：最多一层文件夹；连续/首尾 `\` 与空段在提交时收敛 */
    const normalize = (raw: string): string => {
        const parts = String(raw ?? '')
            .replaceAll('\n', '')
            .split('\\')
            .map((part) => part.trim())
            .filter(Boolean)
        if (parts.length === 0) return ''
        if (parts.length === 1) return parts[0]
        const folder = parts[0]
        const leaf = parts.slice(1).join('/')
        return `${folder}\\${leaf}`
    }

    const plainTextOf = (): string => el?.innerText.replaceAll('\n', '') ?? ''

    const caretOffset = (): number => {
        if (!el || !window.getSelection()?.rangeCount) return 0
        const range = window.getSelection()!.getRangeAt(0)
        const pre = range.cloneRange()
        pre.selectNodeContents(el)
        pre.setEnd(range.endContainer, range.endOffset)
        return pre.toString().length
    }

    const setCaret = (offset: number): void => {
        if (!el) return
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let remaining = Math.max(0, offset)
        let node = walker.nextNode()
        while (node) {
            const len = node.textContent?.length ?? 0
            if (remaining <= len) {
                const range = document.createRange()
                range.setStart(node, remaining)
                range.collapse(true)
                const sel = window.getSelection()
                sel?.removeAllRanges()
                sel?.addRange(range)
                return
            }
            remaining -= len
            node = walker.nextNode()
        }
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
    }

    const appendPart = (text: string, bold: boolean, sep: boolean): void => {
        if (!el) return
        const span = document.createElement('span')
        span.textContent = text
        if (bold) span.className = 'font-bold'
        if (sep) span.className = 'opacity-35'
        el.appendChild(span)
    }

    /** @desc 把纯文本重绘成富文本；caret 为纯文本 offset，重绘后恢复，避免输入光标跳到末尾 */
    const render = (text: string, caret?: number): void => {
        if (!el) return
        const parts = text.split('\\')
        el.replaceChildren()
        parts.forEach((part, index) => {
            if (index > 0) appendPart('\\', false, true)
            appendPart(part, index < parts.length - 1, false)
        })
        if (caret !== undefined) setCaret(caret)
    }

    const commit = () => {
        const next = normalize(plainTextOf())
        if (!next) {
            render(value)
            return
        }
        render(next)
        if (next !== value) oncommit(next)
    }

    const handleInput = () => {
        if (!el || composing) return
        const caret = caretOffset()
        render(plainTextOf(), caret)
    }

    const handleFocus = () => {
        focused = true
        render(value)
        setCaret(value.length)
    }

    const handleBlur = () => {
        focused = false
        commit()
    }

    onMount(() => {
        render(value)
    })

    $effect(() => {
        if (!el || focused) return
        render(value)
    })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={el}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    spellcheck="false"
    data-placeholder={placeholder}
    class={mergeClass([
        'min-w-0 cursor-text whitespace-pre-wrap break-all rounded-none border bg-(--theme-input-bg) px-2 py-1 text-xs leading-5 text-(--theme-modal-text) outline-none focus:border-(--theme-accent-bg) empty:before:pointer-events-none empty:before:text-(--theme-modal-text)/30 empty:before:content-[attr(data-placeholder)]',
        className
    ])}
    style="border-color: var(--theme-divider-border); {styleProp}"
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => {
        composing = false
        handleInput()
    }}
    onkeydown={(e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            el?.blur()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            render(value)
            el?.blur()
        }
    }}
    onpaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData?.getData('text') ?? ''
        document.execCommand('insertText', false, text)
    }}
></div>
