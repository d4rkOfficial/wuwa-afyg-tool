import vercelAdapter from '@sveltejs/adapter-vercel'
import cloudflareAdapter from '@sveltejs/adapter-cloudflare'

const deployTarget = process.env.DEPLOY_TARGET || 'vercel'

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
    },
    kit: {
        adapter: deployTarget === 'cloudflare' ? cloudflareAdapter() : vercelAdapter(),
        prerender: {
            entries: ['/']
        }
    }
}

export default config
