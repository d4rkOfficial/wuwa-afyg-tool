import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { SvelteKitPWA } from '@vite-pwa/sveltekit'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit(),
        SvelteKitPWA({
            registerType: 'autoUpdate',
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
                        urlPattern: /^\/api\/v1\//,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/static\.nanoka\.cc\/assets\/ww\//,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'nanoka-cdn',
                            expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 60 * 60 },
                            cacheableResponse: { statuses: [0, 200] }
                        }
                    }
                ]
            }
        })
    ]
})
