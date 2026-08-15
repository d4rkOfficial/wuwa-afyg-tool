import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { SvelteKitPWA } from '@vite-pwa/sveltekit'
import { defineConfig } from 'vite'

// 数据上游图片/静态资源的 CDN 源（与 provider 的图标源一致）。
// 默认 nanoka；切换上游时，若新上游的图标源不同，同步调整此值。
const DATA_CDN_ORIGIN = 'https://static.nanoka.cc'
const dataCdnPattern = new RegExp('^' + DATA_CDN_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit(),
        SvelteKitPWA({
            registerType: 'autoUpdate',
            devOptions: { enabled: true },
            manifest: {
                name: '椰果工具箱',
                short_name: '椰果',
                description: '鸣潮社区公益工具',
                theme_color: '#1e1b2e',
                background_color: '#1e1b2e',
                display: 'standalone',
                scope: '/',
                start_url: '/',
                icons: [
                    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp}'],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: /^\/api\/v[12]\//,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }
                        }
                    },
                    {
                        urlPattern: dataCdnPattern,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'data-cdn',
                            expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 60 * 60 },
                            cacheableResponse: { statuses: [0, 200] }
                        }
                    }
                ]
            }
        })
    ]
})
