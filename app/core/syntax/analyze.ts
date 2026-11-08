/**
 * 语法精读：把一句话切成「主干（主语/谓语/补足语）+ 修饰块」。
 *
 * 不追求完整的句法分析，只做阅读时真正有用的三件事：
 * 1. 找出主语和谓语，让用户即使不认识全句也能抓到「谁做了什么」；
 * 2. 把从句、分词短语、介词短语这类附加成分单独成块，可以整块跳过；
 * 3. 保持原来的词序，不做任何语序重排。
 *
 * 词性来自 compromise（项目已有依赖），再做一层面向阅读的启发式修正。
 */

import nlp from 'compromise'

export type SyntaxRole = 'subject' | 'predicate' | 'complement' | 'modifier'

export type SyntaxPart = {
  role: SyntaxRole
  /** 已经带好尾随空格的文本，渲染时用 pre-wrap 即可 */
  text: string
}

export type SyntaxChunk = {
  kind: 'core' | 'modifier'
  /** 修饰块是否单独起一行（长从句、分词短语才换行） */
  breakBefore: boolean
  parts: SyntaxPart[]
  /** 该块包含的单词数，用于决定要不要换行 */
  words: number
}

export type SyntaxSentence = {
  text: string
  chunks: SyntaxChunk[]
  /** 对应的中文，可能为空 */
  cn: string
}

type RawToken = {
  text: string
  /** 尾随标点，如 ","  ";" */
  punct: string
  lower: string
  tags: string[]
}

const SUBORDINATORS = new Set([
  'that',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'while',
  'because',
  'although',
  'though',
  'if',
  'unless',
  'since',
  'as',
  'after',
  'before',
  'until',
  'whether',
  'whereas',
  'once',
  'so',
  'than',
])

const AUX = new Set([
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
])

const PREPOSITIONS = new Set([
  'in',
  'on',
  'at',
  'for',
  'with',
  'without',
  'during',
  'despite',
  'about',
  'from',
  'by',
  'into',
  'over',
  'under',
  'between',
  'among',
  'against',
  'through',
  'across',
  'around',
  'per',
  'via',
  'toward',
  'towards',
])

function isVerb(tags: string[]): boolean {
  return tags.some(tag => tag === 'Verb' || tag === 'Copula' || tag === 'Modal' || tag === 'Infinitive')
}

function isParticiple(tags: string[]): boolean {
  return tags.includes('Gerund') || tags.includes('Participle')
}

/**
 * compromise 的 terms 会丢标点（有时连逗号都吞掉），所以词形和标点自己扫，
 * 只把词性标签按顺序对齐过来。
 */
function tokenize(sentence: string): RawToken[] {
  const tagged = (nlp(sentence).json()[0]?.terms ?? []).map(term => ({
    text: String(term.text ?? ''),
    tags: Array.isArray(term.tags) ? term.tags : ([] as string[]),
  }))

  const result: RawToken[] = []
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|[^\sA-Za-z0-9]/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(sentence))) {
    const raw = match[0]
    if (!/[A-Za-z0-9]/.test(raw[0])) {
      if (raw !== '-') result.push({ text: '', punct: raw, lower: '', tags: [] })
      continue
    }

    const lower = raw.toLowerCase()
    let tags: string[] = []
    for (let look = cursor; look < Math.min(cursor + 3, tagged.length); look++) {
      const candidate = tagged[look].text.toLowerCase().replace(/[^a-z0-9'’-]/g, '')
      if (candidate === lower || candidate.startsWith(lower) || lower.startsWith(candidate)) {
        tags = tagged[look].tags
        cursor = look + 1
        break
      }
    }
    result.push({ text: raw, punct: '', lower, tags })
  }

  return result
}

type Clause = {
  tokens: RawToken[]
  /** 从句/分词/介词开头 → 修饰成分 */
  modifier: boolean
  /** 该从句起始的引导词，用于判断换行 */
  lead: string
  /** 前面是不是逗号/冒号这类停顿，用来区分非限定从句 */
  afterPunct: boolean
}

/** 切成从句：遇到分句标点，或遇到从属连词/关系词/分词短语 */
function splitClauses(tokens: RawToken[]): Clause[] {
  const clauses: Clause[] = []
  let current: RawToken[] = []
  let afterPunct = false

  const push = (nextAfterPunct = false) => {
    if (!current.length) return
    const first = current[0]
    const modifier =
      SUBORDINATORS.has(first.lower) || PREPOSITIONS.has(first.lower) || isParticiple(first.tags)
    clauses.push({ tokens: current, modifier, lead: first.lower, afterPunct })
    current = []
    afterPunct = nextAfterPunct
  }

  tokens.forEach((token, index) => {
    const startsSubordinate =
      index > 0 &&
      SUBORDINATORS.has(token.lower) &&
      !SUBORDINATORS.has(tokens[index - 1].lower) &&
      // "so that" / "as if" 这类固定搭配不拆
      !(tokens[index - 1].lower === 'so' || tokens[index - 1].lower === 'as')

    const startsParticiple =
      index > 1 &&
      isParticiple(token.tags) &&
      !isParticiple(tokens[index - 1].tags) &&
      !AUX.has(tokens[index - 1].lower)

    if (startsSubordinate || startsParticiple) {
      push()
    }

    current.push(token)

    if (/[,;:—–]/.test(token.punct)) push(true)
  })
  push()
  return clauses.filter(clause => clause.tokens.length > 0)
}

/** 在从句里找主动词的下标；找不到就返回 -1 */
function mainVerbIndex(tokens: RawToken[]): number {
  for (let i = 0; i < tokens.length; i++) {
    if (isVerb(tokens[i].tags)) {
      // 跳过 "to" 后面的不定式，它通常属于补足语
      if (tokens[i].lower === 'to') continue
      return i
    }
  }
  return -1
}

function renderParts(tokens: RawToken[], role: SyntaxRole): SyntaxPart[] {
  return tokens.map((token, index) => {
    const next = tokens[index + 1]
    // 标点紧跟前面的词，标点后面才是空格
    const trailing = !next ? '' : next.text ? ' ' : ''
    return {
      // 单独的标点不着色，否则会出现蓝色的逗号
      role: token.text ? role : 'complement',
      text: token.text + token.punct + trailing,
    }
  })
}

function buildCore(tokens: RawToken[]): SyntaxChunk {
  const verbIndex = mainVerbIndex(tokens)
  if (verbIndex <= 0) {
    // 没有主语（祈使句/"There is"）或找不到动词：整体当补足语，保持原样
    return { kind: 'core', breakBefore: false, parts: renderParts(tokens, 'complement'), words: tokens.length }
  }

  // 谓语包含前面的助动词/情态动词链
  let start = verbIndex
  while (start > 0 && AUX.has(tokens[start - 1].lower)) start--

  // 往后吃掉同一动词组的词：may coexist / would ask / has been working
  let end = verbIndex
  while (end + 1 < tokens.length) {
    const next = tokens[end + 1]
    if (next.lower === 'to') break
    if (isVerb(next.tags) || ['not', "n't", 'never'].includes(next.lower)) {
      end++
      continue
    }
    break
  }

  // 主语是谓语之前的名词性成分；如果前面还有介词短语，归到修饰块更准确
  const subjectTokens = tokens.slice(0, start)
  const predicateTokens = tokens.slice(start, end + 1)
  const complementTokens = tokens.slice(end + 1)

  const parts: SyntaxPart[] = []
  if (subjectTokens.length) parts.push(...renderParts(subjectTokens, 'subject'))
  if (predicateTokens.length) {
    const rendered = renderParts(predicateTokens, 'predicate')
    // 谓语后面还有补足语时，补一个空格
    if (complementTokens.length) rendered[rendered.length - 1].text += ' '
    parts.push(...rendered)
  }
  if (complementTokens.length) parts.push(...renderParts(complementTokens, 'complement'))

  return { kind: 'core', breakBefore: false, parts, words: tokens.length }
}

function buildModifier(clause: Clause, firstModifier: boolean): SyntaxChunk {
  const words = clause.tokens.length
  // 只有确实“长到会打断主干”的附加成分才单独起行：
  // 逗号/冒号后面的非限定从句（≥6 词），或者任何 ≥8 词的从句/分词短语。
  // 短的（while the sun is up / who shops）留在行内，只做淡色处理。
  const longClause = words >= 8
  const nonRestrictive = clause.afterPunct && words >= 6
  const breakBefore = !firstModifier && (longClause || nonRestrictive)
  return {
    kind: 'modifier',
    breakBefore,
    parts: renderParts(clause.tokens, 'modifier'),
    words,
  }
}

export function analyzeSentence(sentence: string, cn = ''): SyntaxSentence {
  const text = sentence.trim()
  const tokens = tokenize(text)
  if (!tokens.length) return { text, chunks: [], cn }

  const clauses = splitClauses(tokens)
  const chunks: SyntaxChunk[] = []
  let coreSeen = false

  clauses.forEach(clause => {
    if (!clause.modifier && !coreSeen) {
      chunks.push(buildCore(clause.tokens))
      coreSeen = true
      return
    }
    // 第二个及之后的主干从句（并列句）保持行内，不强行拆行
    if (!clause.modifier) {
      chunks.push({ ...buildCore(clause.tokens), breakBefore: false })
      return
    }
    chunks.push(buildModifier(clause, !coreSeen))
  })

  normalizeSpacing(chunks)
  return { text, chunks, cn }
}

/**
 * 跨块拼接时补回空格：块与块之间不会自动带空格。
 * 规则只有两条：标点紧跟前面的词；两个词之间留一个空格。
 */
function normalizeSpacing(chunks: SyntaxChunk[]) {
  const all = chunks.flatMap(chunk => chunk.parts)
  all.forEach((part, index) => {
    const next = all[index + 1]
    const trimmed = part.text.replace(/\s+$/, '')
    if (!next) {
      part.text = trimmed
      return
    }
    const nextStartsPunct = /^[^\w\s]/.test(next.text.trimStart())
    part.text = nextStartsPunct ? trimmed : `${trimmed} `
  })
}

/** 按 . ! ? / 。！？ 切句；中文句间没有空格，分开处理 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const isChinese = /[\u4e00-\u9fa5]/.test(normalized)
  const parts = isChinese
    ? normalized.split(/(?<=[。！？!?])/)
    : normalized.split(/(?<=[.!?])\s+(?=[A-Z"'“(])/)
  return parts.map(item => item.trim()).filter(Boolean)
}

/** 英文段落 + 中文段落 → 逐句对齐（句子数一致时按句对，否则整段兜底） */
export function pairParagraph(english: string, chinese: string): SyntaxSentence[] {
  const sentences = splitSentences(english)
  const cnSentences = splitSentences(chinese)
  const aligned = sentences.length === cnSentences.length
  return sentences.map((sentence, index) =>
    analyzeSentence(sentence, aligned ? cnSentences[index] : index === 0 ? chinese : '')
  )
}
