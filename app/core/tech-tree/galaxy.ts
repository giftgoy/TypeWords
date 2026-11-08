/**
 * 单词星图：把一本词典里的词铺成一座旋涡星系。
 * 位置完全由词序 + 哈希决定，刷新后星位不变；亮度/颜色只取决于掌握程度。
 */

export type StarLevel = 'new' | 'learning' | 'review' | 'strong' | 'mastered'

export type Star = {
  word: string
  meaning: string
  x: number
  y: number
  /** 0–1 掌握度 */
  score: number
  level: StarLevel
  /** 绘制半径（世界坐标） */
  size: number
  /** 0–1 透明度 */
  alpha: number
  /** 闪烁相位，0–2π */
  phase: number
}

export const STAR_COLORS: Record<StarLevel, { core: string; glow: string }> = {
  new: { core: '#94a3b8', glow: 'rgba(148, 163, 184, 0.35)' },
  learning: { core: '#22d3ee', glow: 'rgba(34, 211, 238, 0.55)' },
  review: { core: '#a5b4fc', glow: 'rgba(129, 140, 248, 0.6)' },
  strong: { core: '#fbbf24', glow: 'rgba(251, 191, 36, 0.7)' },
  mastered: { core: '#fde68a', glow: 'rgba(253, 230, 138, 0.9)' },
}

export const STAR_LEVEL_LABEL: Record<StarLevel, string> = {
  new: '未学',
  learning: '学习中',
  review: '复习中',
  strong: '熟练',
  mastered: '已掌握',
}

/** 32 位字符串哈希，用来给每颗星一点固定的抖动 */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function noise(value: string, salt: number): number {
  const h = hashString(`${value}#${salt}`)
  return (h % 10000) / 10000
}

export type FsrsLike = {
  state?: number
  reps?: number
  stability?: number
  lapses?: number
}

/**
 * 掌握度：
 * - 在“已掌握”名单里 → 1
 * - 没有 FSRS 卡片或没练过 → 0
 * - 学习中/重学 → 0.3 左右
 * - 复习中按 stability（记忆稳定天数）线性抬到 1
 */
export function masteryScore(word: string, fsrs: Record<string, FsrsLike>, known: Set<string>): number {
  const raw = String(word || '').trim()
  if (!raw) return 0
  const key = raw.toLowerCase()
  if (known.has(key)) return 1

  const card = fsrs[raw] ?? fsrs[key]
  if (!card || !card.reps) return 0

  const reps = card.reps ?? 0
  const stability = card.stability ?? 0
  const lapses = card.lapses ?? 0

  let score: number
  if (card.state === 2) {
    score = 0.55 + Math.min(0.45, stability / 60)
  } else {
    score = 0.3 + Math.min(0.2, reps * 0.03)
  }
  score -= Math.min(0.15, lapses * 0.03)
  return Math.max(0.05, Math.min(0.99, score))
}

export function levelOf(score: number): StarLevel {
  if (score >= 0.95) return 'mastered'
  if (score >= 0.75) return 'strong'
  if (score >= 0.45) return 'review'
  if (score > 0) return 'learning'
  return 'new'
}

/** 旋涡星系布局：3–5 条旋臂，半径按面积均匀分布 */
export function buildStars(
  words: { word: string; meaning: string; score: number }[],
  options: { radius?: number; arms?: number; spin?: number } = {}
): Star[] {
  const total = words.length || 1
  const radius = options.radius ?? 1000
  const arms = options.arms ?? (total > 5000 ? 5 : total > 2000 ? 4 : 3)
  const spin = options.spin ?? Math.PI * 2 * 1.45
  const rMin = radius * 0.06

  return words.map((item, index) => {
    const t = (index + 0.5) / total
    const arm = index % arms
    const baseAngle = (arm / arms) * Math.PI * 2
    const jitterAngle = (noise(item.word, 1) - 0.5) * 0.18
    const jitterRadius = (noise(item.word, 2) - 0.5) * 0.06
    const r = (rMin + (radius - rMin) * Math.sqrt(t)) * (1 + jitterRadius)
    const angle = baseAngle + t * spin + jitterAngle

    return {
      word: item.word,
      meaning: item.meaning,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.62, // 压扁一点，看起来像侧视的星系盘
      score: item.score,
      level: levelOf(item.score),
      size: 1.7 + item.score * 2.1 + noise(item.word, 3) * 0.6,
      alpha: 0.46 + item.score * 0.52,
      phase: noise(item.word, 4) * Math.PI * 2,
    }
  })
}
