<script lang="ts">
    /**
     * @desc 工程临时分享弹窗：双二维码（工具箱 / fast-calc）+ 两条只读链接 + 过期倒计时。
     *
     * 只读输入框承担「剪贴板写不进去」环境的复制入口（内嵌 WebView 里长按选中即可），
     * 因此弹窗不提供底部操作栏——关闭走外壳自带的右上角按钮。
     * 倒计时按快照的 `expiresAt` 每秒重算，到点自动收起弹窗。
     */
    import Icon from '@iconify/svelte'
    import qrcode from 'qrcode-generator'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { formatShareCountdown, isShareSnapshotExpired } from '$lib/data/share.utils'
    import type { ShareSnapshot } from '$lib/data/share.utils'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 当前展示的分享快照（null 时面板内不渲染内容） */
        snapshot: ShareSnapshot | null
        onclose: () => void
    }

    let { open, snapshot, onclose, class: className, style: styleProp }: Props = $props()

    /** @desc 链接 → 可缩放二维码 SVG：版本与纠错自动，深色模块取容器文字色、白底由容器铺 */
    const qrSvgOf = (text: string): string => {
        const qr = qrcode(0, 'M')
        qr.addData(text)
        qr.make()
        return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
    }

    let now = $state(Date.now())

    $effect(() => {
        if (!open || !snapshot) return
        now = Date.now()
        const timer = setInterval(() => {
            now = Date.now()
        }, 1000)
        return () => clearInterval(timer)
    })

    const remainingMs = $derived(snapshot ? Math.max(0, snapshot.expiresAt - now) : 0)
    const remainingLabel = $derived(formatShareCountdown(remainingMs))

    /** @desc 到期自动关闭：倒计时先归零，随后收起弹窗 */
    $effect(() => {
        if (open && snapshot && isShareSnapshotExpired(snapshot, now)) onclose()
    })

    const qrCards = $derived(
        snapshot
            ? [
                  { key: 'tool', label: '工具箱分享码', svg: qrSvgOf(snapshot.toolLink) },
                  { key: 'fast-calc', label: '简表速览分享码', svg: qrSvgOf(snapshot.fastCalcLink) }
              ]
            : []
    )

    /** @desc 点一下就全选，省掉拖动选择（触屏上尤其难选） */
    const selectAll = (e: Event): void => {
        ;(e.currentTarget as HTMLInputElement).select()
    }
</script>

<Modal {open} {onclose} layer="nested" class={mergeClass(['w-[26rem]', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:share-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>工程临时分享</span>
    {/snippet}

    {#if snapshot}
        <div class="grid grid-cols-2 gap-3">
            {#each qrCards as card (card.key)}
                <div class="flex flex-col items-center gap-2">
                    <!-- 二维码固定黑码白底：不跟主题走，深色主题下才扫得出来 -->
                    <div class="aspect-square w-full max-w-[132px] p-2" style="background: #fff; color: #000;">
                        {@html card.svg}
                    </div>
                    <span class="text-[11px] leading-none text-(--theme-modal-text)/60">{card.label}</span>
                </div>
            {/each}
        </div>

        <div class="mt-4 flex flex-col gap-3">
            <div>
                <FieldLabel label="工具箱分享链接" />
                <input
                    type="text"
                    readonly
                    value={snapshot.toolLink}
                    onclick={selectAll}
                    onfocus={selectAll}
                    spellcheck="false"
                    aria-label="工具箱分享链接"
                    class="mt-1 w-full cursor-text rounded-none border px-2.5 py-1.5 text-[11px] text-(--theme-modal-text) outline-none"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </div>
            <div>
                <FieldLabel label="简表速览分享链接" />
                <input
                    type="text"
                    readonly
                    value={snapshot.fastCalcLink}
                    onclick={selectAll}
                    onfocus={selectAll}
                    spellcheck="false"
                    aria-label="简表速览分享链接"
                    class="mt-1 w-full cursor-text rounded-none border px-2.5 py-1.5 text-[11px] text-(--theme-modal-text) outline-none"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </div>
        </div>

        <div
            class="mt-4 flex items-center justify-center gap-1.5 border-t pt-3 text-[11px] text-(--theme-modal-text)/50"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:timer-sand" class="size-3.5" />
            <span>分享过期倒计时</span>
            <span class="text-xs font-black tabular-nums text-(--theme-accent-text)">{remainingLabel}</span>
        </div>
    {/if}
</Modal>
