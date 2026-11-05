// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
    /**
     * @desc 是否「无服务端独立静态包」构建（`STANDALONE=1`）。
     * 由 `vite.config.ts` 的 `define` 在编译期替换成字面量 true/false（不是运行时环境变量），
     * 因此 `if (__OFFLINE_BUILD__)` 里的分支在正常构建里会被直接删掉。
     */
    const __OFFLINE_BUILD__: boolean

    namespace App {
        // interface Error {}
        // interface Locals {}
        // interface PageData {}
        // interface PageState {}
        // interface Platform {}
    }
}

export {}
