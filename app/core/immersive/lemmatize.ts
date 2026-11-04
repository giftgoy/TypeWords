/**
 * 极简英文词形还原（lemma）工具。
 *
 * 目标：把正文里出现的变形（studies / studied / studying / stopped）映射回
 * 词库中的原形（study / stop），用于匹配离线词库里的目标词与搭配。
 *
 * 设计取舍：
 * - 纯函数、无依赖，方便用 node --test 单测；
 * - 只覆盖常见后缀 + 约 200 条不规则变形，词库本身只有 2607 个词，够用；
 * - 返回“候选列表”而不是唯一答案，由调用方按词库是否存在来挑选，
 *   避免规则派生出词库里没有的假原形。
 */

// 不规则动词 / 常见变形 → 原形
export const IRREGULAR_LEMMAS: Record<string, string> = {
  // be / have / do
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  has: 'have',
  had: 'have',
  having: 'have',
  does: 'do',
  did: 'do',
  done: 'do',
  doing: 'do',
  // 高频不规则
  went: 'go',
  gone: 'go',
  goes: 'go',
  said: 'say',
  says: 'say',
  made: 'make',
  took: 'take',
  taken: 'take',
  came: 'come',
  saw: 'see',
  seen: 'see',
  knew: 'know',
  known: 'know',
  got: 'get',
  gotten: 'get',
  gave: 'give',
  given: 'give',
  found: 'find',
  thought: 'think',
  told: 'tell',
  became: 'become',
  left: 'leave',
  felt: 'feel',
  brought: 'bring',
  began: 'begin',
  begun: 'begin',
  kept: 'keep',
  held: 'hold',
  wrote: 'write',
  written: 'write',
  stood: 'stand',
  heard: 'hear',
  meant: 'mean',
  met: 'meet',
  ran: 'run',
  paid: 'pay',
  sat: 'sit',
  spoke: 'speak',
  spoken: 'speak',
  led: 'lead',
  grew: 'grow',
  grown: 'grow',
  lost: 'lose',
  fell: 'fall',
  fallen: 'fall',
  sent: 'send',
  built: 'build',
  understood: 'understand',
  drew: 'draw',
  drawn: 'draw',
  broke: 'break',
  broken: 'break',
  spent: 'spend',
  rose: 'rise',
  risen: 'rise',
  drove: 'drive',
  driven: 'drive',
  bought: 'buy',
  wore: 'wear',
  worn: 'wear',
  chose: 'choose',
  chosen: 'choose',
  ate: 'eat',
  eaten: 'eat',
  threw: 'throw',
  thrown: 'throw',
  caught: 'catch',
  taught: 'teach',
  fought: 'fight',
  sought: 'seek',
  sold: 'sell',
  flew: 'fly',
  flown: 'fly',
  forgot: 'forget',
  forgotten: 'forget',
  hid: 'hide',
  hidden: 'hide',
  hit: 'hit',
  hurt: 'hurt',
  cost: 'cost',
  cut: 'cut',
  put: 'put',
  read: 'read',
  set: 'set',
  shut: 'shut',
  spread: 'spread',
  stood_by: 'stand by',
  woke: 'wake',
  woken: 'wake',
  won: 'win',
  sang: 'sing',
  sung: 'sing',
  swam: 'swim',
  swum: 'swim',
  drank: 'drink',
  drunk: 'drink',
  rang: 'ring',
  rung: 'ring',
  shone: 'shine',
  shot: 'shoot',
  slept: 'sleep',
  slid: 'slide',
  smelled: 'smell',
  smelt: 'smell',
  stole: 'steal',
  stolen: 'steal',
  stuck: 'stick',
  struck: 'strike',
  swept: 'sweep',
  swore: 'swear',
  sworn: 'swear',
  tore: 'tear',
  torn: 'tear',
  woke_up: 'wake up',
  bore: 'bear',
  borne: 'bear',
  beat: 'beat',
  beaten: 'beat',
  bent: 'bend',
  bet: 'bet',
  bit: 'bite',
  bitten: 'bite',
  bled: 'bleed',
  blew: 'blow',
  blown: 'blow',
  bred: 'breed',
  burnt: 'burn',
  burned: 'burn',
  dealt: 'deal',
  dug: 'dig',
  dove: 'dive',
  fed: 'feed',
  fled: 'flee',
  forbade: 'forbid',
  forgiven: 'forgive',
  froze: 'freeze',
  frozen: 'freeze',
  hung: 'hang',
  laid: 'lay',
  lain: 'lie',
  lay: 'lie',
  lent: 'lend',
  lit: 'light',
  lying: 'lie',
  rode: 'ride',
  ridden: 'ride',
  shook: 'shake',
  shaken: 'shake',
  shed: 'shed',
  sank: 'sink',
  sunk: 'sink',
  spun: 'spin',
  spat: 'spit',
  split: 'split',
  spoil: 'spoil',
  spoilt: 'spoil',
  sprang: 'spring',
  sprung: 'spring',
  stung: 'sting',
  stank: 'stink',
  strove: 'strive',
  striven: 'strive',
  swore_off: 'swear off',
  wept: 'weep',
  wound: 'wind',
  withdrew: 'withdraw',
  withdrawn: 'withdraw',
  // 不规则复数 / 比较级
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  geese: 'goose',
  mice: 'mouse',
  phenomena: 'phenomenon',
  criteria: 'criterion',
  analyses: 'analysis',
  crises: 'crisis',
  theses: 'thesis',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  further: 'far',
  farther: 'far',
  eldest: 'old',
}

// 缩写 → 原形（正文里很常见，不还原会让 it's / don't 全部漏标）
export const CONTRACTIONS: Record<string, string> = {
  "it's": 'it',
  "that's": 'that',
  "there's": 'there',
  "he's": 'he',
  "she's": 'she',
  "here's": 'here',
  "what's": 'what',
  "let's": 'let',
  "i'm": 'be',
  "i've": 'have',
  "i'll": 'will',
  "i'd": 'would',
  "we're": 'be',
  "we've": 'have',
  "we'll": 'will',
  "they're": 'be',
  "they've": 'have',
  "they'll": 'will',
  "you're": 'be',
  "you've": 'have',
  "you'll": 'will',
  "don't": 'do',
  "doesn't": 'do',
  "didn't": 'do',
  "isn't": 'be',
  "aren't": 'be',
  "wasn't": 'be',
  "weren't": 'be',
  "haven't": 'have',
  "hasn't": 'have',
  "hadn't": 'have',
  "can't": 'can',
  cannot: 'can',
  "couldn't": 'could',
  "won't": 'will',
  "wouldn't": 'would',
  "shouldn't": 'should',
  "mustn't": 'must',
  "needn't": 'need',
}

const CONSONANT_DOUBLE = /([b-df-hj-np-tv-z])\1$/

/** 去掉首尾标点、转小写（保留词内部的撇号和连字符） */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z]+$/, '')
}

/**
 * 生成一个词的所有可能原形候选，按可信度从高到低。
 * 调用方依次检查词库是否存在即可，不必纠结规则是否“正确”。
 */
export function lemmaCandidates(token: string): string[] {
  const out: string[] = []
  const push = (w?: string) => {
    if (!w) return
    const v = w.trim()
    if (v.length >= 2 && !out.includes(v)) out.push(v)
  }

  const t = normalizeToken(token)
  if (!t) return out

  push(t)

  if (CONTRACTIONS[t]) push(CONTRACTIONS[t])
  if (IRREGULAR_LEMMAS[t]) push(IRREGULAR_LEMMAS[t])

  // 所有格：Lin's -> Lin, teacher's -> teacher
  const possessive = t.replace(/'s$/, '')
  if (possessive !== t) {
    push(possessive)
    if (IRREGULAR_LEMMAS[possessive]) push(IRREGULAR_LEMMAS[possessive])
  }

  const w = possessive

  // 复数 / 第三人称单数
  if (/ies$/.test(w) && w.length > 4) push(w.slice(0, -3) + 'y')
  if (/es$/.test(w) && w.length > 3) push(w.slice(0, -2))
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) push(w.slice(0, -1))

  // 过去式 / 过去分词
  if (/ied$/.test(w) && w.length > 4) push(w.slice(0, -3) + 'y')
  if (/ed$/.test(w)) {
    const stem = w.slice(0, -2)
    push(stem)
    push(w.slice(0, -1)) // hoped -> hope
    if (CONSONANT_DOUBLE.test(stem)) push(stem.slice(0, -1)) // stopped -> stop
  }

  // 现在分词
  if (/ing$/.test(w) && w.length > 4) {
    const stem = w.slice(0, -3)
    push(stem)
    push(stem + 'e') // making -> make
    if (CONSONANT_DOUBLE.test(stem)) push(stem.slice(0, -1)) // running -> run
  }

  // 比较级 / 最高级 / 副词
  if (/ier$/.test(w) && w.length > 4) push(w.slice(0, -3) + 'y') // happier -> happy
  if (/iest$/.test(w) && w.length > 5) push(w.slice(0, -4) + 'y') // happiest -> happy
  if (/er$/.test(w) && w.length > 4) {
    push(w.slice(0, -2))
    push(w.slice(0, -1))
  }
  if (/est$/.test(w) && w.length > 5) push(w.slice(0, -3))
  if (/ly$/.test(w) && w.length > 4) {
    if (/ily$/.test(w)) push(w.slice(0, -3) + 'y')
    push(w.slice(0, -2))
  }

  return out
}

/** 在给定词表里挑出第一个存在的原形；找不到返回 null */
export function pickLemma(token: string, has: (word: string) => boolean): string | null {
  for (const candidate of lemmaCandidates(token)) {
    if (has(candidate)) return candidate
  }
  return null
}
