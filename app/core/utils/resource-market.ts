import type { Article, Dict, DictResource, Word } from '../types/types.ts'

export const READING_LEVELS = [
  { value: 'A1', name: '入门', description: '读懂短句和熟悉的日常场景' },
  { value: 'A2', name: '基础', description: '理解简单故事与日常经历' },
  { value: 'B1', name: '中级', description: '理解连贯叙述，表达原因和感受' },
  { value: 'B2', name: '中高级', description: '比较观点，分析社会与科技话题' },
  { value: 'C1', name: '高级', description: '读懂复杂论证与隐含态度' },
  { value: 'C2', name: '精通挑战', description: '辨认修辞、细微立场与抽象推论' },
] as const

export type MarketKind = 'word' | 'article'
export type MarketResource = DictResource & {
  level?: string
  levelNote?: string
  learningFocus?: string
  wordRange?: [number, number]
  source?: string
  sourceUrl?: string
  license?: string
  icon?: string
  accent?: string
  featured?: boolean
  hidden?: boolean
}
export type MarketFilters = {
  query?: string
  category?: string
  level?: string
  installedOnly?: boolean
  sort?: string
}
type Identity = { id?: unknown; enName?: unknown }
function identities(resource: Identity) {
  return [resource.id, resource.enName]
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(String)
}
export function findInstalledResource<T extends Identity>(resource: Identity, library: T[]): T | undefined {
  const keys = identities(resource)
  return library.find(item => identities(item).some(key => keys.includes(key)))
}
export function addResourceToLibrary<T extends Identity>(resource: T, library: T[]): boolean {
  if (findInstalledResource(resource, library)) return false
  library.push(resource)
  return true
}
export function readMarketCatalog(value: unknown): MarketResource[] {
  if (!Array.isArray(value)) throw new Error('资源目录格式不正确，请重试。')
  const ids = new Set<string>()
  return value
    .filter(item => !item?.hidden)
    .map(item => {
      if (
        !item ||
        !identities(item).length ||
        typeof item.name !== 'string' ||
        typeof item.url !== 'string' ||
        !/^[\w.-]+\.json$/.test(item.url) ||
        item.url.includes('..') ||
        !Number.isInteger(item.length) ||
        item.length < 1 ||
        !Array.isArray(item.tags) ||
        typeof item.category !== 'string' ||
        item.language !== 'en'
      ) {
        throw new Error('资源目录中有不完整的条目，请重试。')
      }
      if (ids.has(String(item.id))) throw new Error('资源目录中有重复的条目。')
      ids.add(String(item.id))
      return item as MarketResource
    })
}
export function filterMarketResources(resources: MarketResource[], filters: MarketFilters, library: Identity[] = []) {
  const query = (filters.query || '').trim().toLocaleLowerCase()
  const results = resources.filter(resource => {
    if (filters.category && resource.category !== filters.category) return false
    if (filters.level && resource.level !== filters.level) return false
    if (filters.installedOnly && !findInstalledResource(resource, library)) return false
    const text = [
      resource.name,
      resource.enName,
      resource.description,
      resource.category,
      resource.level,
      ...resource.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return !query || query.split(/\s+/).every(term => text.includes(term))
  })
  if (filters.sort === 'count-asc') return results.sort((a, b) => a.length - b.length)
  if (filters.sort === 'count-desc') return results.sort((a, b) => b.length - a.length)
  if (filters.sort === 'name') return results.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return results.sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
}
export function readMarketContent(resource: MarketResource, kind: MarketKind, value: unknown): Partial<Dict> {
  if (!Array.isArray(value) || !value.length) throw new Error('这份资源暂时没有可用内容。')
  const valid =
    kind === 'word'
      ? value.every(
          item =>
            typeof item?.word === 'string' &&
            item.word.trim() &&
            Array.isArray(item.trans) &&
            item.trans.every(trans => typeof trans?.cn === 'string') &&
            item.trans.some(trans => trans.cn.trim())
        )
      : value.every(
          item =>
            typeof item?.title === 'string' && item.title.trim() && typeof item.text === 'string' && item.text.trim()
        )
  if (!valid) throw new Error('资源内容不完整，未添加到学习库。请重试。')
  return {
    ...resource,
    length: value.length,
    words: kind === 'word' ? (value as Word[]) : [],
    articles: kind === 'article' ? (value as Article[]) : [],
  }
}
