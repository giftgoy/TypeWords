import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradedBooks } from './market-content.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commit = '1182426f2bd0a28c95302c33f9e19136b1262a70'
const upstream = 'https://github.com/RealKai42/qwerty-learner'
const rawBase = `https://raw.githubusercontent.com/RealKai42/qwerty-learner/${commit}`
const offline = process.argv.includes('--offline')
const definitions = [
  [
    'nce1-words',
    '新概念英语 1 · 词汇',
    'NCE_1.json',
    '基础入门',
    'N1',
    'mint',
    ['入门', '日常交流'],
    '从日常问候、家庭和生活场景开始，建立基础词汇。',
  ],
  [
    'nce2-words',
    '新概念英语 2 · 词汇',
    'NCE_2.json',
    '基础入门',
    'N2',
    'mint',
    ['基础', '叙事表达'],
    '积累叙事和日常表达词汇，从简单句走向完整表达。',
  ],
  [
    'junior',
    '初中英语 · 北京版',
    'beijing_junior_high_school.json',
    '基础入门',
    '初',
    'sky',
    ['初中', '基础词汇'],
    '覆盖学校、家庭和日常生活的基础英语词汇。',
  ],
  [
    'cet6',
    'CET-6 大学英语六级',
    'CET6_T.json',
    '国内考试',
    'C6',
    'indigo',
    ['六级', '大学英语'],
    '在四级基础上拓展阅读、写作与学术表达词汇。',
  ],
  [
    'kaoyan',
    '考研英语',
    'KaoYan_3_T.json',
    '国内考试',
    '研',
    'amber',
    ['考研', '阅读理解'],
    '面向研究生英语入学考试，积累阅读和写作常用词。',
  ],
  [
    'tem4',
    'TEM-4 英语专业四级',
    'Level4luan_2_T.json',
    '国内考试',
    'T4',
    'rose',
    ['专四', '英语专业'],
    '适合英语专业学习者，扩展语义、表达与阅读词汇。',
  ],
  [
    'ielts',
    'IELTS 雅思',
    'IELTS_3_T.json',
    '留学考试',
    'IE',
    'indigo',
    ['雅思', '学术英语'],
    '围绕教育、环境、社会等主题积累雅思备考词汇。',
  ],
  [
    'toefl',
    'TOEFL 托福',
    'TOEFL_3_T.json',
    '留学考试',
    'TO',
    'sky',
    ['托福', '校园与学术'],
    '为校园交流、学术阅读和讲座理解打好词汇基础。',
  ],
  [
    'gre',
    'GRE 进阶词汇',
    'GRE_3_T.json',
    '留学考试',
    'GR',
    'rose',
    ['GRE', '高阶阅读'],
    '挑战更精细的语义辨析，拓展高阶书面语词汇。',
  ],
  [
    'gmat',
    'GMAT 词汇',
    'GMAT_3_T.json',
    '留学考试',
    'GM',
    'amber',
    ['GMAT', '商科阅读'],
    '积累商业、逻辑和论证场景中的英语词汇。',
  ],
  [
    'sat',
    'SAT 词汇',
    'SAT_3_T.json',
    '留学考试',
    'SA',
    'indigo',
    ['SAT', '阅读与写作'],
    '为长篇阅读、论证理解和准确表达扩展词汇量。',
  ],
  [
    'business',
    '商务英语 BEC',
    'BEC_2_T.json',
    '职业英语',
    'BE',
    'mint',
    ['商务', '职场沟通'],
    '从会议、采购到市场营销，积累真实工作场景词汇。',
  ],
  [
    'computing',
    '计算机专业英语',
    'itVocabulary.json',
    '职业英语',
    '</>',
    'sky',
    ['计算机', '技术文档'],
    '读懂技术文档，熟悉计算机与软件领域常见术语。',
  ],
]

async function json(path, value) {
  await mkdir(dirname(resolve(root, path)), { recursive: true })
  await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n')
}

async function download(path) {
  const cache = resolve(root, '.typewords.local/sources/qwerty', path)
  if (offline) return readFile(cache, 'utf8')
  const response = await fetch(`${rawBase}/${path}`, { signal: AbortSignal.timeout(45000) })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const text = await response.text()
  await mkdir(dirname(cache), { recursive: true })
  await writeFile(cache, text)
  return text
}

const [original] = JSON.parse(await readFile(resolve(root, 'public/list/word.json'), 'utf8'))
if (original.id !== 1) throw new Error('Expected the original CET-4 resource to remain first.')
const cet4 = {
  ...original,
  category: '国内考试',
  tags: ['四级', '大学英语'],
  translateLanguage: 'zh-CN',
  description: '大学英语四级词库，附音标、释义、例句与词源，适合系统巩固。',
  source: 'TypeWords 随附词库',
  sourceUrl: 'https://github.com/giftgoy/TypeWords',
  icon: 'C4',
  accent: 'indigo',
  featured: true,
}
const sources = []
const words = [cet4]
// Keep resource order stable and only replace catalogs after every download succeeds.
for (const [slug, name, filename, category, icon, accent, tags, description] of definitions) {
  const raw = await download(`public/dicts/${filename}`)
  const input = JSON.parse(raw)
  if (!Array.isArray(input) || !input.length) throw new Error(`Empty dictionary: ${filename}`)
  const seen = new Set()
  const invalidEntries = []
  const data = input.flatMap((item, index) => {
    const word = item.name?.trim()
    const translations = (typeof item.trans === 'string' ? [item.trans] : Array.isArray(item.trans) ? item.trans : [])
      .map(value => String(value).trim())
      .filter(Boolean)
    if (!word || !translations.length) {
      invalidEntries.push(index)
      return []
    }
    const key = word.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        id: `market-${slug}-${index}`,
        word,
        phonetic0: item.usphone || '',
        phonetic1: item.ukphone || '',
        trans: translations.map(cn => ({ pos: '', cn })),
        sentences: [],
        phrases: [],
        synos: [],
        relWords: { root: '', rels: [] },
        etymology: [],
      },
    ]
  })
  if (!data.length || invalidEntries.length > input.length * 0.2)
    throw new Error(`Unexpected source format: ${filename}`)
  const url = `market-${slug}.json`
  await json(`public/dicts/en/word/${url}`, data)
  const sourceUrl = `${upstream}/blob/${commit}/public/dicts/${filename}`
  const resource = {
    id: `market-${slug}`,
    enName: `market-${slug}`,
    name,
    description,
    category,
    icon,
    accent,
    tags,
    url,
    length: data.length,
    type: 'word',
    language: 'en',
    translateLanguage: 'zh-CN',
    version: 1,
    source: 'Qwerty Learner',
    sourceUrl,
    license: 'GPL-3.0',
    featured: ['nce1-words', 'cet6', 'ielts'].includes(slug),
  }
  words.push(resource)
  sources.push({
    id: resource.id,
    sourceUrl,
    sha256: createHash('sha256').update(raw).digest('hex'),
    output: url,
    count: data.length,
    skippedInvalidIndexes: invalidEntries,
  })
  console.log(`${name}: ${data.length} words`)
}

const existingArticles = JSON.parse(await readFile(resolve(root, 'public/dicts/en/article/NCE_1.json'), 'utf8'))
const articles = []
for (const [bookIndex, book] of gradedBooks.entries()) {
  const data = book.articles.map((article, index) => ({
    id: 910000 + bookIndex * 100 + index,
    title: article.title,
    titleTranslate: article.titleTranslate,
    text: article.lines.map(pair => pair[0]).join('\n\n'),
    textTranslate: article.lines.map(pair => pair[1]).join('\n\n'),
    sections: [],
    newWords: [],
    audioSrc: '',
    audioFileId: '',
    lrcPosition: [],
    questions: [],
    nameList: [],
  }))
  const counts = data.map(article => article.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0)
  const url = `graded-${book.level.toLowerCase()}.json`
  await json(`public/dicts/en/article/${url}`, data)
  articles.push({
    id: `graded-${book.level.toLowerCase()}`,
    enName: `graded-${book.level.toLowerCase()}`,
    name: book.name,
    description: book.description,
    category: book.category,
    tags: book.tags,
    level: book.level,
    levelNote: '参考难度，非官方 CEFR 评级',
    learningFocus: book.focus,
    icon: book.level,
    accent: ['mint', 'sky', 'indigo', 'amber', 'rose', 'indigo'][bookIndex],
    url,
    length: data.length,
    type: 'article',
    language: 'en',
    translateLanguage: 'zh-CN',
    version: 1,
    source: '原创双语读物',
    license: 'CC0-1.0',
    wordRange: [Math.min(...counts), Math.max(...counts)],
    featured: bookIndex < 3,
  })
}
articles.push({
  id: 246,
  enName: 'nce1',
  name: '新概念英语 1 · 示例',
  description: '项目原有的 5 篇入门对话，包含原版音频。',
  category: '经典教材',
  tags: ['新概念英语', '日常对话', '含音频'],
  url: 'NCE_1.json',
  length: existingArticles.length,
  language: 'en',
  translateLanguage: 'zh-CN',
  type: 'article',
  version: 1,
  level: 'A1',
  levelNote: '参考难度，非官方 CEFR 评级',
  icon: 'N1',
  accent: 'mint',
  source: 'TypeWords 随附示例',
  sourceUrl: 'https://github.com/giftgoy/TypeWords',
  cover: '/imgs/covers/nce-1.png',
})

const license = await download('LICENSE')
await mkdir(resolve(root, 'public/resource-licenses'), { recursive: true })
await writeFile(resolve(root, 'public/resource-licenses/qwerty-learner-GPL-3.0.txt'), license)
await writeFile(
  resolve(root, 'public/resource-licenses/original-readers-CC0.txt'),
  'The original bilingual graded readers in graded-a1.json through graded-c2.json were created for this local TypeWords extension.\nThey are dedicated to the public domain under CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\nDifficulty labels are editorial learning references, not official CEFR certifications.\n'
)
await json('public/list/word.json', words)
await json(
  'public/list/recommend_word.json',
  words.filter(book => book.featured)
)
await json('public/list/article.json', articles)
await json(
  'public/list/recommend_article.json',
  articles.filter(book => book.featured)
)
await json('public/list/resource-sources.json', {
  upstream,
  commit,
  license: 'GPL-3.0',
  dictionaries: sources,
  originalReaders: 'CC0-1.0',
})
console.log(`Ready: ${words.length} dictionaries, ${articles.length} article collections.`)
