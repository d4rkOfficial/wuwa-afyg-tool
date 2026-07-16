/** @type {import("prettier").Config} */
const config = {
    useTabs: false,
    tabWidth: 4,
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    printWidth: 120,
    plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
    overrides: [{ files: '*.svelte', options: { parser: 'svelte', useTabs: false, tabWidth: 4 } }],
    tailwindStylesheet: './src/routes/layout.css'
}

export default config
