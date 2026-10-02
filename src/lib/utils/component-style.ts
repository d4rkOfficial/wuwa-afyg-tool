import type { ComponentsProps } from '$lib/types'

/**
 * @desc class 片段合并：过滤假值后用空格连接。
 * 用法 `mergeClass(['base', active && 'on', className])`，等价于手写 `[...].filter(Boolean).join(' ')`。
 */
export const mergeClass = (parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

/**
 * @desc style 片段合并：过滤假值后用 `;` 连接。
 * 需要自定义片段（如 avatar 的 `background-image`、button 的变体底色）时用它；
 * 仅需标准的 backgroundImage / textColor / style 三件套时用 `mergeComponentsStyle`。
 */
export const joinStyle = (parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(';')

/**
 * @desc 把 `ComponentsProps` 的主题配色三项合并成一条 style 字符串。
 * 覆盖绝大多数组件，避免每个组件重复写同一段 `$derived` 派生块。
 *
 * 注：`backgroundImage` 语义为整条 `background` 简写（可传渐变/颜色/图片）；
 * `textColor` 为前景色；`style` 为调用方内联样式，最后拼接故可覆盖前两者。
 */
export const mergeComponentsStyle = ({
    backgroundImage,
    textColor,
    style
}: Pick<ComponentsProps, 'backgroundImage' | 'textColor' | 'style'>): string =>
    joinStyle([
        backgroundImage ? `background: ${backgroundImage}` : '',
        textColor ? `color: ${textColor}` : '',
        style || ''
    ])
