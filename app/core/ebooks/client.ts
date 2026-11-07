import { withAppBaseURL } from '../utils/base-url'

export type EbookIssue = {
  id: string
  title: string
  name: string
  publication: string
  date: string
  sourceUrl: string
  files: { format: string; size: number; url: string }[]
}
export type EbookCatalog = {
  issues: EbookIssue[]
  revision: string
  checkedAt: number | null
  error: string
  sourceUrl: string
}
export type EbookStatus = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  issue: EbookIssue
  received: number
  total: number
  error: string
  chapters?: { id: string; title: string; wordCount: number }[]
}
export async function ebooksRequest<T>(path: string, post = false): Promise<T> {
  const response = await fetch(withAppBaseURL('/api/data/ebooks' + path), {
    method: post ? 'POST' : 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(35000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || '外刊资源暂时无法读取，请稍后重试。')
  return data as T
}
export function fileSize(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
