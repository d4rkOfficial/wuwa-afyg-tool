<script lang="ts">
    import type { ComponentsProps } from '$lib/types'
    import Prism from 'prismjs'
    import 'prismjs/components/prism-json'
    import 'prismjs/components/prism-typescript'
    import 'prismjs/themes/prism-dark.css'

    interface Props extends ComponentsProps {
        code: string
        lang?: string
    }

    let { code, lang = 'typescript', class: className, style }: Props = $props()

    let html = $derived.by(() => {
        if (!code) return ''
        const grammar = lang === 'json' ? Prism.languages.json : Prism.languages.typescript
        try {
            return Prism.highlight(code, grammar, lang)
        } catch {
            return code
        }
    })
</script>

<pre {style} class="p-5 overflow-x-auto text-sm leading-relaxed font-mono {className ?? ''}"><code>{@html html}</code>
</pre>
