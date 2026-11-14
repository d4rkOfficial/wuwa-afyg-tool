import { redirect } from '@sveltejs/kit'

/**
 * @desc v2 角色详情不返回数据：v3 在富文本描述之上补了角色定位标签 tags，是当前的角色详情来源。
 * 本路由用 308 永久重定向把调用方路由到 v3，并借状态码本身告知「请改用 v3 角色详情」；
 * 查询串（如 ?provider=xxx）原样带过去，保证数据源选择不丢。
 */
export const GET = ({ params, url }: { params: { name: string }; url: URL }) => {
    const target = new URL(`/api/v3/info/character/${encodeURIComponent(params.name)}`, url.origin)
    target.search = url.search
    redirect(308, target.pathname + target.search)
}
