import { withAppBaseURL } from '../utils/base-url.ts'

export async function readingRequest(path: string, body?: unknown) {
  const response = await fetch(withAppBaseURL(`/api/reading/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('阅读生成服务未启动，请启动 typewords-reading 服务。')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '阅读服务请求失败')
  return data
}
