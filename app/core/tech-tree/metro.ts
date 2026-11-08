/**
 * 词典地铁图：坐标是手绘的，线路像真实地铁图一样分组。
 * 数据仍然只有一份（tree.ts 的节点与依赖），这里只负责“画在哪儿”和“属于哪条线”。
 */

export type MetroStation = { x: number; y: number }

export const METRO_STATIONS: Record<string, MetroStation> = {
  // 主干（红）
  nce1w: { x: 110, y: 320 },
  nce2w: { x: 250, y: 320 },
  junior: { x: 390, y: 320 },
  cet4: { x: 530, y: 320 },
  cet6: { x: 670, y: 320 },
  kaoyan: { x: 810, y: 320 },

  // 留学（蓝）
  gmat: { x: 530, y: 190 },
  ielts: { x: 670, y: 190 },
  toefl: { x: 810, y: 190 },
  gre: { x: 950, y: 190 },
  sat: { x: 810, y: 80 },

  // 专业（绿）
  tem4: { x: 530, y: 440 },
  business: { x: 670, y: 440 },
  computing: { x: 670, y: 550 },

  // 阅读（橙）
  a1: { x: 110, y: 630 },
  a2: { x: 250, y: 630 },
  b1: { x: 390, y: 630 },
  b2: { x: 530, y: 630 },
  c1: { x: 670, y: 630 },
  c2: { x: 810, y: 630 },
  nce1a: { x: 110, y: 730 },
}

export const METRO_CANVAS = { width: 1040, height: 790 }

export type MetroRoute = {
  id: string
  name: string
  color: string
  /** 依次经过的站点，画线时按顺序连成折线 */
  stations: string[]
  /** 是不是支线（线更细、标签更小） */
  branch?: boolean
}

export const METRO_ROUTES: MetroRoute[] = [
  { id: 'trunk', name: '主干线', color: '#e11d48', stations: ['nce1w', 'nce2w', 'junior', 'cet4', 'cet6', 'kaoyan'] },
  { id: 'abroad', name: '留学线', color: '#2563eb', stations: ['cet6', 'ielts', 'toefl', 'gre'] },
  { id: 'abroad-gmat', name: '留学线 · GMAT 支线', color: '#2563eb', stations: ['ielts', 'gmat'], branch: true },
  { id: 'abroad-sat', name: '留学线 · SAT 支线', color: '#2563eb', stations: ['toefl', 'sat'], branch: true },
  { id: 'career-a', name: '专业线 · 专四', color: '#059669', stations: ['cet4', 'tem4'], branch: true },
  { id: 'career-b', name: '专业线', color: '#059669', stations: ['cet6', 'business', 'computing'] },
  { id: 'reading', name: '阅读线', color: '#ea580c', stations: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'] },
  { id: 'reading-nce', name: '阅读线 · 新概念支线', color: '#ea580c', stations: ['a1', 'nce1a'], branch: true },
]

/** 换乘站：被两条及以上线路经过 */
export function metroTransfers(): Set<string> {
  const counter = new Map<string, number>()
  METRO_ROUTES.forEach(route => {
    new Set(route.stations).forEach(station => {
      counter.set(station, (counter.get(station) ?? 0) + 1)
    })
  })
  const result = new Set<string>()
  counter.forEach((count, id) => {
    if (count >= 2) result.add(id)
  })
  return result
}

/** 颜色辅助：站点属于哪条线（取第一条经过它的线路） */
export function metroColorOf(station: string): string {
  const route = METRO_ROUTES.find(item => item.stations.includes(station))
  return route?.color ?? '#8b95a5'
}
