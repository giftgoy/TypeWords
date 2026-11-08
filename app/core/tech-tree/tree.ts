/**
 * 科技树（学习路径图）的数据定义与布局计算。
 *
 * 节点全部对应资源市场里真实存在的词库 / 分级读物，进度由
 * useBaseStore().word.bookList / article.bookList 的 lastLearnIndex 推导，
 * 不额外保存任何状态。
 */

export type TreeNodeSide = 'word' | 'article'

export type TreeNodeDef = {
  /** 科技树内部 id */
  id: string
  /** 对应 public/list/word.json 或 article.json 里的资源 id */
  marketId: string
  side: TreeNodeSide
  /** 前置节点 id */
  deps: string[]
  /** 同一层里的排列顺序 */
  order: number
  tagline: string
  fallbackName: string
  fallbackLength: number
}

/** 进度到达该百分比即视为“点亮” */
export const LIT_THRESHOLD = 80

export const TREE_NODES: TreeNodeDef[] = [
  // ── 词汇主干 ──────────────────────────────────────────────
  {
    id: 'nce1w',
    marketId: 'market-nce1-words',
    side: 'word',
    deps: [],
    order: 0,
    tagline: '从问候、家庭和生活场景起手，先把高频词铺开。',
    fallbackName: '新概念英语 1 · 词汇',
    fallbackLength: 861,
  },
  {
    id: 'nce2w',
    marketId: 'market-nce2-words',
    side: 'word',
    deps: ['nce1w'],
    order: 0,
    tagline: '叙事和日常表达词汇，从短句走向完整表达。',
    fallbackName: '新概念英语 2 · 词汇',
    fallbackLength: 833,
  },
  {
    id: 'junior',
    marketId: 'market-junior',
    side: 'word',
    deps: ['nce2w'],
    order: 0,
    tagline: '学校、家庭、日常生活的完整基础词汇面。',
    fallbackName: '初中英语 · 北京版',
    fallbackLength: 1836,
  },
  {
    id: 'cet4',
    marketId: '1',
    side: 'word',
    deps: ['junior'],
    order: 0,
    tagline: '四级核心词，附音标、释义、例句与词源。',
    fallbackName: 'CET-4',
    fallbackLength: 2607,
  },
  {
    id: 'cet6',
    marketId: 'market-cet6',
    side: 'word',
    deps: ['cet4'],
    order: 0,
    tagline: '在四级之上拓展阅读、写作与学术表达。',
    fallbackName: 'CET-6 大学英语六级',
    fallbackLength: 2345,
  },
  {
    id: 'kaoyan',
    marketId: 'market-kaoyan',
    side: 'word',
    deps: ['cet6'],
    order: 3,
    tagline: '考研阅读与写作常用词，偏学术与论述。',
    fallbackName: '考研英语',
    fallbackLength: 3727,
  },
  {
    id: 'tem4',
    marketId: 'market-tem4',
    side: 'word',
    deps: ['cet4'],
    order: 1,
    tagline: '英语专业四级，语义、搭配与阅读词汇更细。',
    fallbackName: 'TEM-4 英语专业四级',
    fallbackLength: 4025,
  },
  {
    id: 'ielts',
    marketId: 'market-ielts',
    side: 'word',
    deps: ['cet6'],
    order: 0,
    tagline: '教育、环境、社会等主题的雅思备考词汇。',
    fallbackName: 'IELTS 雅思',
    fallbackLength: 3575,
  },
  {
    id: 'toefl',
    marketId: 'market-toefl',
    side: 'word',
    deps: ['ielts'],
    order: 0,
    tagline: '校园交流、学术阅读、讲座理解的词汇底座。',
    fallbackName: 'TOEFL 托福',
    fallbackLength: 4264,
  },
  {
    id: 'gre',
    marketId: 'market-gre',
    side: 'word',
    deps: ['toefl'],
    order: 0,
    tagline: '高阶书面语与语义辨析，最长的一条分支。',
    fallbackName: 'GRE 进阶词汇',
    fallbackLength: 6514,
  },
  {
    id: 'sat',
    marketId: 'market-sat',
    side: 'word',
    deps: ['toefl'],
    order: 1,
    tagline: '长篇阅读、论证理解与准确表达的词汇量。',
    fallbackName: 'SAT 词汇',
    fallbackLength: 4463,
  },
  {
    id: 'gmat',
    marketId: 'market-gmat',
    side: 'word',
    deps: ['ielts'],
    order: 2,
    tagline: '商业、逻辑与论证场景中的英语词汇。',
    fallbackName: 'GMAT 词汇',
    fallbackLength: 3047,
  },
  {
    id: 'business',
    marketId: 'market-business',
    side: 'word',
    deps: ['cet6'],
    order: 1,
    tagline: '会计、采购到市场营运的真实职场场景词。',
    fallbackName: '商务英语 BEC',
    fallbackLength: 2753,
  },
  {
    id: 'computing',
    marketId: 'market-computing',
    side: 'word',
    deps: ['cet6'],
    order: 2,
    tagline: '读懂技术文档，熟悉计算机与软件术语。',
    fallbackName: '计算机专业英语',
    fallbackLength: 1665,
  },

  // ── 阅读支线 ──────────────────────────────────────────────
  {
    id: 'a1',
    marketId: 'graded-a1',
    side: 'article',
    deps: [],
    order: 1,
    tagline: '从清晨、购物和公园开始，用短句读懂身边小事。',
    fallbackName: 'A1 · 生活中的第一句话',
    fallbackLength: 4,
  },
  {
    id: 'nce1a',
    marketId: 'nce1',
    side: 'article',
    deps: ['a1'],
    order: 2,
    tagline: '新概念 1 的 5 篇入门对话，带原版音频。',
    fallbackName: '新概念英语 1 · 示例',
    fallbackLength: 5,
  },
  {
    id: 'a2',
    marketId: 'graded-a2',
    side: 'article',
    deps: ['a1'],
    order: 0,
    tagline: '一次短途旅行、一张借书卡，在熟悉的场景里讲事情。',
    fallbackName: 'A2 · 把日子过成小故事',
    fallbackLength: 4,
  },
  {
    id: 'b1',
    marketId: 'graded-b1',
    side: 'article',
    deps: ['a2', 'cet4'],
    order: 0,
    tagline: '讲述一次尝试、解释一个选择，在完整语境里表达。',
    fallbackName: 'B1 · 成长与小小改变',
    fallbackLength: 4,
  },
  {
    id: 'b2',
    marketId: 'graded-b2',
    side: 'article',
    deps: ['b1'],
    order: 0,
    tagline: '从城市、地图和维修文化出发，练习比较观点。',
    fallbackName: 'B2 · 看见社会与科技',
    fallbackLength: 4,
  },
  {
    id: 'c1',
    marketId: 'graded-c1',
    side: 'article',
    deps: ['b2'],
    order: 0,
    tagline: '探讨专业判断、城市生活与语言，读懂隐含立场。',
    fallbackName: 'C1 · 复杂世界的多重视角',
    fallbackLength: 4,
  },
  {
    id: 'c2',
    marketId: 'graded-c2',
    side: 'article',
    deps: ['c1'],
    order: 0,
    tagline: '面对指标、历史与公共讨论，辨识修辞与假设。',
    fallbackName: 'C2 · 在文字之间思辨',
    fallbackLength: 4,
  },
]

export type TreeNodeState = 'lit' | 'active' | 'unlocked' | 'locked'

export type TreeNodeGeometry = {
  tier: number
  lane: number
}

export type TreeNodeView = TreeNodeDef & {
  name: string
  description: string
  length: number
  icon: string
  accent: string
  installed: boolean
  learned: number
  progress: number
  state: TreeNodeState
  missingDeps: string[]
  tier: number
  lane: number
}

export type TreeEdge = {
  from: string
  to: string
  lit: boolean
}

/** 按最长路径计算层级；依赖里出现未知 id 时忽略该依赖 */
export function computeTiers(defs: TreeNodeDef[]): Map<string, number> {
  const byId = new Map(defs.map(d => [d.id, d]))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) return 0 // 数据写错成环时兜底，不让它死循环
    visiting.add(id)
    const def = byId.get(id)
    const value = def
      ? def.deps.filter(dep => byId.has(dep)).reduce((max, dep) => Math.max(max, visit(dep) + 1), 0)
      : 0
    visiting.delete(id)
    depth.set(id, value)
    return value
  }

  defs.forEach(def => visit(def.id))
  return depth
}

/** 同一层内按 order 排序后依次占位 */
export function computeLanes(defs: TreeNodeDef[], tiers: Map<string, number>): Map<string, number> {
  const lanes = new Map<string, number>()
  const grouped = new Map<number, TreeNodeDef[]>()
  defs.forEach(def => {
    const tier = tiers.get(def.id) ?? 0
    const bucket = grouped.get(tier) ?? []
    bucket.push(def)
    grouped.set(tier, bucket)
  })
  grouped.forEach(bucket => {
    bucket
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .forEach((def, index) => lanes.set(def.id, index))
  })
  return lanes
}

export function accentColor(accent?: string): string {
  switch (accent) {
    case 'indigo':
      return '#6366f1'
    case 'sky':
      return '#0ea5e9'
    case 'mint':
      return '#10b981'
    case 'amber':
      return '#f59e0b'
    case 'rose':
      return '#f43f5e'
    default:
      return '#8b95a5'
  }
}
