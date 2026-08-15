// 上游抓取已收敛到 $lib/api/provider/* 适配器中；这里只保留与上游无关的通用工具。

export const createJsonResponse = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    })
