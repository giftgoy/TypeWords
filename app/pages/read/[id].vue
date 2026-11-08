<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DICT_LIST, SAVE_DICT_KEY } from '@/core/config/env'
import { useBaseStore } from '@/core/stores/base'
import { useSettingStore } from '@/core/stores/setting'
import { useTTsPlayAudio } from '@/core/hooks/sound'
import { get as getStoredValue } from '@/core/utils/storage'
import { resourceWrap } from '@/core/utils'
import { readMarketCatalog, type MarketResource } from '@/core/utils/resource-market'
import { buildReadingScript, groupScriptByParagraph, indexOfSentenceWithWord } from '@/core/reading/sentences'
import { useArticleSpeech } from '@/core/reading/useArticleSpeech'
import type { ArticleExplanation, ExplainMode } from '@/core/reading/explain'
import ArticleAiExplain from '@/components/article/ArticleAiExplain.vue'

useHead({ title: '沉浸阅读 · TypeWords' })

const route = useRoute()
const router = useRouter()

type VocabItem = {
  form?: string
  lemma?: string
  meaning?: string
  phonetic?: string
}

type ArticleWord = {
  word: string
  phonetic0?: string
  phonetic1?: string
  trans?: { pos?: string; cn?: string }[]
  sentences?: { c?: string; cn?: string }[]
}

type ArticleDoc = {
  id: string | number
  title: string
  titleTranslate?: string
  text: string
  textTranslate?: string
  newWords?: ArticleWord[]
  readingStudy?: { theme?: string; vocabulary?: VocabItem[]; targets?: string[] }
}

type WordCard = {
  word: string
  phonetic: string
  pos: string
  meaning: string
  example: string
  exampleCn: string
}

const loading = ref(true)
const error = ref('')
/** 非致命提示（例如整篇太长需要分段讲解） */
const hint = ref('')
const articles = ref<ArticleDoc[]>([])
const index = ref(0)
const bookName = ref('')
const store = useBaseStore()
/** 通用释义索引：文章没带词表时，用它给重点词配读音和释义 */
const glossIndex = ref<Record<string, { p?: string; t?: string }>>({})

const article = computed<ArticleDoc | null>(() => articles.value[index.value] ?? null)

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(resourceWrap(url), { cache: 'no-cache', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`${response.status}`)
  return (await response.json()) as T
}

async function resolveBook(id: string): Promise<{ name: string; url: string } | null> {
  try {
    const catalog = readMarketCatalog(await fetchJson(DICT_LIST.ARTICLE.ALL))
    // 外刊：抓取服务单独维护一份目录，和分级读物合并后再查
    const feedCatalog = await fetchJson<unknown>('/dicts/en/article/feed/index.json')
      .then(data => readMarketCatalog(data))
      .catch(() => [] as MarketResource[])
    const merged = [...catalog, ...feedCatalog]
    const found = merged.find(item => String(item.id) === id)
    if (!found) return null
    return { name: found.name, url: `/dicts/en/article/${found.url}` }
  } catch {
    return null
  }
}

/** 已安装/自建读物（ebooks-xxx、读书会导入的书）不在资源目录里，要去 store 或本地存档里找 */
async function findStoredBook(id: string) {
  const match = (book: any) => book && (String(book.id) === id || String(book.enName ?? '') === id)

  const fromArticle = (store.article.bookList ?? []).find(match)
  if (fromArticle?.articles?.length) return fromArticle

  // 有些导入的电子书挂在词库列表里
  const fromWord = (store.word.bookList ?? []).find(match) as any
  if (fromWord?.articles?.length) return fromWord

  try {
    const raw = await getStoredValue(SAVE_DICT_KEY.key)
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const lists = [parsed?.val?.article?.bookList, parsed?.val?.word?.bookList].filter(Array.isArray)
      for (const list of lists) {
        const found = (list as any[]).find(match)
        if (found?.articles?.length) return found
      }
    }
  } catch {
    /* 存档读不出来就走资源目录 */
  }
  return fromArticle ?? fromWord ?? null
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const id = decodeURIComponent(String(route.params.id ?? ''))
    const stored = await findStoredBook(id)

    if (stored?.articles?.length) {
      bookName.value = stored.name ?? '本地读物'
      articles.value = stored.articles as ArticleDoc[]
    } else if (stored?.url) {
      // 已安装但正文被换书时清空了，按 url 重新取一次
      bookName.value = stored.name ?? '本地读物'
      articles.value = (await fetchJson<ArticleDoc[]>(`/dicts/en/article/${stored.url}`)) ?? []
    } else {
      const book = await resolveBook(id)
      if (!book) throw new Error('找不到这本读物：本地没有正文，资源目录里也没有')
      bookName.value = book.name
      articles.value = (await fetchJson<ArticleDoc[]>(book.url)) ?? []
    }

    if (!articles.value.length) throw new Error('这本读物还没有正文，先去书籍页打开一次')
    const wanted = Number(route.query.chapter ?? '0')
    if (Number.isFinite(wanted) && wanted >= 0 && wanted < articles.value.length) index.value = wanted
    if (!Object.keys(glossIndex.value).length) await loadGlossIndex()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

/** 载入通用释义索引（15k 词，够覆盖分级读物和外刊） */
async function loadGlossIndex() {
  try {
    const data = await fetchJson<{ words?: Record<string, { p?: string; t?: string }> }>(
      '/dicts/en/word/reading-gloss.json'
    )
    glossIndex.value = data?.words ?? {}
  } catch {
    glossIndex.value = {}
  }
}

const paragraphs = computed(() => {
  const current = article.value
  if (!current?.text) return []
  const en = current.text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  const cn = (current.textTranslate ?? '').split(/\n{2,}/).map(block => block.trim())
  return en.map((block, i) => ({ en: block, cn: cn[i] ?? '' }))
})

const setting = useSettingStore()
const speakText = useTTsPlayAudio()

/** 逐句朗读脚本：段落 → 句子，句序号在全文范围内连续 */
const script = computed(() => buildReadingScript(paragraphs.value.map(item => item.en)))
const scriptGroups = computed(() => groupScriptByParagraph(script.value))

const {
  state: audioState,
  index: audioIndex,
  progress: audioProgress,
  rate: audioRate,
  loop: audioLoop,
  engine: audioEngine,
  error: audioError,
  notice: audioNotice,
  total: audioTotal,
  duration: audioDuration,
  elapsed: audioElapsed,
  playAt,
  pause: pauseAudio,
  toggle: toggleAudio,
  seek: seekAudio,
  setEngine,
} = useArticleSpeech(() => script.value)

const bodyRef = ref<HTMLElement | null>(null)

/** 只在一句接一句朗读时跟随滚动，手动点句/暂停时不抢滚动条 */
watch([audioIndex, audioState], ([sentence, state]) => {
  if (state !== 'playing') return
  const node = bodyRef.value?.querySelector<HTMLElement>(`[data-sentence="${sentence}"]`)
  node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

/** 每篇文章各自记住读到第几句 */
const positionKey = computed(
  () => `typewords:read-sentence:${route.params.id}:${article.value?.id ?? index.value}`
)

function storedSentence(key: string): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

watch(
  positionKey,
  key => {
    const saved = storedSentence(key)
    if (saved > 0) audioIndex.value = saved
  },
  { immediate: true }
)

watch(audioIndex, value => {
  try {
    localStorage.setItem(positionKey.value, String(value))
  } catch {
    /* 忽略存储受限 */
  }
})

/** 重点词：先停下文章朗读，再单独发音 */
function speakWord(word: string) {
  pauseAudio()
  void speakText(word, { rate: setting.wordSoundSpeed, volume: setting.wordSoundVolume / 100 })
}

/** 重点词：跳到它所在的句子开始读 */
function playSentenceWithWord(word: string) {
  const at = indexOfSentenceWithWord(script.value, word)
  if (at >= 0) playAt(at)
}

/* ── AI 讲解 ───────────────────────────────────────────────────────────
 * 模型与密钥在「设置 → AI 模型」里统一配置；这里只发正文、渲染结果。
 * 整篇超过 6000 字符时提示按段落讲解，避免一次请求过大。
 */
type ExplainTarget = { key: string; text: string; mode: ExplainMode; heading: string }

const AI_EXPLAIN_LIMIT = 6000
const aiExplain = ref<ExplainTarget | null>(null)
/** 按「文章/章节」分开缓存：同一个 key 换篇目后会重新请求 */
const explainCacheByArticle = ref<Record<string, Record<string, ArticleExplanation>>>({})
const explainCache = computed<Record<string, ArticleExplanation>>(
  () => explainCacheByArticle.value[`${String(route.params.id)}#${article.value?.id ?? index.value}`] ?? {}
)

function cacheKeyFor(explainKey: string) {
  const articleKey = `${String(route.params.id)}#${article.value?.id ?? index.value}`
  return `${articleKey}::${explainKey}`
}

/** 头部按钮：开着就收起，收起后再点直接回到上次的讲解（走缓存，不重复请求） */
const articleExplainReady = computed(() => Object.keys(explainCache.value).length > 0)

/**
 * 当前讲解覆盖到的句子，按段落分组后贴到原文下面。
 * 模型返回的 en 与原文逐字一致（服务端已复核），这里只做空白归一化后比对。
 */
const paragraphNotes = computed<Record<number, Array<{ cn: string; note: string }>>>(() => {
  const current = aiExplain.value
  if (!current) return {}
  const explanation = explainCache.value[current.key]
  if (!explanation?.sentences.length) return {}
  const lookup = new Map<string, { cn: string; note: string }>()
  for (const item of explanation.sentences) lookup.set(normalizeSentence(item.en), { cn: item.cn, note: item.note })
  const out: Record<number, Array<{ cn: string; note: string }>> = {}
  for (const sentence of script.value) {
    const hit = lookup.get(normalizeSentence(sentence.text))
    if (!hit || (!hit.cn && !hit.note)) continue
    ;(out[sentence.paragraph] ??= []).push(hit)
  }
  return out
})

function normalizeSentence(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 头部按钮：开着就收起，收起后再点直接回到上次的讲解（走缓存，不重复请求） */
function toggleArticleExplain() {
  if (aiExplain.value) {
    aiExplain.value = null
    return
  }
  openArticleExplain()
}

function openArticleExplain() {
  const whole = paragraphs.value.map(item => item.en).join('\n\n')
  if (!whole.trim()) {
    hint.value = '这篇文章还没有可讲解的正文。'
    return
  }
  if (whole.length > AI_EXPLAIN_LIMIT) {
    hint.value = `整篇约 ${whole.length} 字符，超过 AI 单次讲解上限（${AI_EXPLAIN_LIMIT} 字符）。请用每段右侧的「AI」按钮逐段讲解。`
    return
  }
  hint.value = ''
  aiExplain.value = {
    key: cacheKeyFor('article'),
    text: whole,
    mode: 'article',
    heading: article.value?.title || '整篇文章',
  }
}

function openParagraphExplain(index: number) {
  const paragraph = paragraphs.value[index]
  if (!paragraph?.en.trim()) return
  hint.value = ''
  aiExplain.value = {
    key: cacheKeyFor(`p-${index}`),
    text: paragraph.en,
    mode: 'paragraph',
    heading: `第 ${index + 1} 段`,
  }
}

function cacheExplanation(key: string, explanation: ArticleExplanation) {
  const articleKey = `${String(route.params.id)}#${article.value?.id ?? index.value}`
  explainCacheByArticle.value = {
    ...explainCacheByArticle.value,
    [articleKey]: { ...(explainCacheByArticle.value[articleKey] ?? {}), [key]: explanation },
  }
}

/** 关键词：优先 newWords，其次精读词汇表，最后用当前词典兜底 */
const textWordSet = computed(() => {
  const set = new Set<string>()
  for (const match of (article.value?.text ?? '').matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
    set.add(match[0].toLowerCase())
  }
  return set
})

const STATUS_WORDS = new Set([
  'about','after','again','against','almost','along','already','also','although','always','among','another','around',
  'back','because','before','behind','being','below','between','both','bring','came','could','during','each','either',
  'every','from','further','have','having','here','herself','himself','into','itself','just','like','made','make',
  'many','might','more','most','much','must','never','only','other','ought','over','same','shall','should','since',
  'some','still','such','than','that','their','them','then','there','these','they','thing','think','this','those',
  'through','under','until','very','were','what','when','where','which','while','with','within','without','would',
  'your','yours','yourself','said','says','went','come','took','take','give','gave','know','knew','well','even',
])

/** 文章里出现、且在通用词表里有释义的词，按长度（≈难度）挑出来 */
const fallbackEntries = computed<{ word: string; gloss: { p?: string; t?: string } }[]>(() => {
  const source = glossIndex.value
  if (!Object.keys(source).length) return []
  const seen = new Map<string, string>()
  for (const match of (article.value?.text ?? '').matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
    const original = match[0]
    const lower = original.toLowerCase()
    if (!seen.has(lower)) seen.set(lower, original)
  }
  const list: { word: string; gloss: { p?: string; t?: string } }[] = []
  seen.forEach((original, lower) => {
    if (lower.length < 5 || STATUS_WORDS.has(lower)) return
    const gloss = source[lower]
    if (!gloss?.t) return
    // 副词/连词/介词这类功能词不当重点词
    if (/^(adv\.|conj\.|prep\.|pron\.|det\.|art\.|aux\.)/.test(gloss.t)) return
    list.push({ word: original, gloss })
  })
  return list.sort((a, b) => b.word.length - a.word.length).slice(0, 12)
})

const keywords = computed(() => {
  const current = article.value
  const list: string[] = []
  current?.newWords?.forEach(word => word.word && list.push(word.word))
  current?.readingStudy?.vocabulary?.forEach(item => (item.form || item.lemma) && list.push(item.form || item.lemma || ''))
  current?.readingStudy?.targets?.forEach(target => list.push(target))
  if (!list.length) fallbackEntries.value.forEach(entry => list.push(entry.word))
  return [...new Set(list.map(item => item.trim()).filter(Boolean))]
})

const keywordPattern = computed(() => {
  if (!keywords.value.length) return null
  const escaped = keywords.value
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
})

type Segment = { text: string; hit: boolean }
const segmentsOf = (text: string): Segment[] => {
  const pattern = keywordPattern.value
  if (!pattern) return [{ text, hit: false }]
  const result: Segment[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) result.push({ text: text.slice(last, start), hit: false })
    result.push({ text: match[0], hit: true })
    last = start + match[0].length
  }
  if (last < text.length) result.push({ text: text.slice(last), hit: false })
  return result.length ? result : [{ text, hit: false }]
}

const cards = computed<WordCard[]>(() => {
  const current = article.value
  if (!current) return []
  const flattened = (current.text ?? '').replace(/\s+/g, ' ')

  if (current.newWords?.length) {
    return current.newWords.map(word => ({
      word: word.word,
      phonetic: word.phonetic0 || word.phonetic1 || '',
      pos: word.trans?.[0]?.pos ?? '',
      meaning: word.trans?.map(item => item.cn).filter(Boolean).join('；') ?? '',
      example: word.sentences?.[0]?.c ?? '',
      exampleCn: word.sentences?.[0]?.cn ?? '',
    }))
  }

  const vocab = current.readingStudy?.vocabulary ?? []
  if (vocab.length) {
    return vocab.map(item => {
      const form = item.form || item.lemma || ''
      const sentence = form ? findSentence(flattened, form) : ''
      return {
        word: form,
        phonetic: item.phonetic ?? '',
        pos: '',
        meaning: item.meaning ?? '',
        example: sentence,
        exampleCn: '',
      }
    })
  }

  // 兜底：文章里出现、且词表里有释义的词
  return fallbackEntries.value.map(entry => ({
    word: entry.word,
    phonetic: entry.gloss.p ?? '',
    pos: '',
    meaning: (entry.gloss.t ?? '').split('；').slice(0, 2).join('；'),
    example: findSentence(flattened, entry.word),
    exampleCn: '',
  }))
})

function findSentence(text: string, form: string): string {
  const lower = text.toLowerCase()
  const at = lower.indexOf(form.toLowerCase())
  if (at < 0) return ''
  const start = Math.max(0, text.lastIndexOf('.', at) + 1)
  const end = text.indexOf('.', at)
  return text.slice(start, end === -1 ? undefined : end + 1).trim()
}

const intro = computed(() => {
  const current = article.value
  return current?.readingStudy?.theme || current?.titleTranslate || ''
})

function goChapter(value: string | number) {
  const next = Number(value)
  if (!Number.isFinite(next) || next === index.value) return
  index.value = next
  router.replace({ query: { ...route.query, chapter: String(next) } })
}

onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <div class="read-page">
    <p v-if="loading" class="read-hint">正在打开…</p>
    <p v-else-if="error" class="read-hint is-error">
      {{ error }}
      <button type="button" class="read-back" @click="router.push('/articles')">回到文章页</button>
    </p>

    <template v-else-if="article">
      <section class="read-left">
        <header class="read-head">
          <p class="read-kicker">{{ bookName }}</p>
          <h1>{{ article.title }}</h1>
          <p v-if="article.titleTranslate" class="read-subtitle">{{ article.titleTranslate }}</p>
          <label v-if="articles.length > 1" class="read-chapter">
            <span>篇目</span>
            <select :value="index" @change="goChapter(($event.target as HTMLSelectElement).value)">
              <option v-for="(item, i) in articles" :key="item.id ?? i" :value="i">
                {{ i + 1 }}. {{ item.title }}
              </option>
            </select>
          </label>
          <div class="read-tools">
            <button
              type="button"
              class="read-ai-btn"
              :class="{ 'is-on': aiExplain }"
              :aria-pressed="!!aiExplain"
              @click="toggleArticleExplain"
            >
              <IconFluentSparkle20Regular />
              <span>{{ articleExplainReady ? '收起讲解' : 'AI 讲解' }}</span>
            </button>
            <NuxtLink class="read-ai-link" to="/setting?index=4">AI 模型设置</NuxtLink>
          </div>
          <p v-if="hint" class="read-hint-inline" role="status">{{ hint }}</p>
        </header>

        <div class="read-cover" aria-hidden="true">
          <div class="read-cover__sky"></div>
          <div class="read-cover__moon"></div>
          <div class="read-cover__ridge"></div>
          <div class="read-cover__ridge is-back"></div>
          <span class="read-cover__caption">{{ article.title }}</span>
        </div>

          <div ref="bodyRef" class="read-body">
            <p v-for="(paragraph, pIndex) in paragraphs" :key="pIndex" class="read-paragraph">
              <button
                type="button"
                class="read-paragraph__ai"
                :aria-pressed="aiExplain?.key === cacheKeyFor(`p-${pIndex}`)"
                :aria-label="`AI 讲解第 ${pIndex + 1} 段`"
                :title="`AI 讲解第 ${pIndex + 1} 段`"
                @click.stop="aiExplain?.key === cacheKeyFor(`p-${pIndex}`) ? (aiExplain = null) : openParagraphExplain(pIndex)"
              >
                AI
              </button>
              <span class="read-en">
                <template v-for="sentence in scriptGroups[pIndex] ?? []" :key="sentence.index">
                  <span
                    class="read-sentence"
                    :class="{ 'is-active': audioState !== 'idle' && audioIndex === sentence.index }"
                    :data-sentence="sentence.index"
                    role="button"
                    tabindex="0"
                    :aria-label="`从第 ${sentence.index + 1} 句开始朗读`"
                    @click="playAt(sentence.index)"
                    @keydown.enter.prevent="playAt(sentence.index)"
                    @keydown.space.prevent="playAt(sentence.index)"
                  >
                    <template v-for="(segment, sIndex) in segmentsOf(sentence.text)" :key="sIndex">
                      <mark v-if="segment.hit" class="read-keyword">{{ segment.text }}</mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </span>{{ ' ' }}
                </template>
              </span>
              <span v-if="paragraph.cn" class="read-cn">{{ paragraph.cn }}</span>

              <!-- AI 讲解开着时，被讲解覆盖的句子直接在原文下方给出中文与难点，不用来回滚动 -->
              <span v-if="paragraphNotes[pIndex]" class="read-sentence-notes">
                <span v-for="(note, nIndex) in paragraphNotes[pIndex]" :key="nIndex" class="read-sentence-note">
                  <span class="read-sentence-note__cn">{{ note.cn || note.note }}</span>
                  <span v-if="note.cn && note.note" class="read-sentence-note__tip">{{ note.note }}</span>
                </span>
              </span>
            </p>
          </div>

        <ArticleReaderPlayer
          :state="audioState"
          :index="audioIndex"
          :total="audioTotal"
          :progress="audioProgress"
          :elapsed="audioElapsed"
          :duration="audioDuration"
          :rate="audioRate"
          :loop="audioLoop"
          :engine="audioEngine"
          :error="audioError"
          :notice="audioNotice"
          @toggle="toggleAudio"
          @prev="playAt(audioIndex - 1)"
          @next="playAt(audioIndex + 1)"
          @seek="seekAudio"
          @update:rate="value => (audioRate = value)"
          @update:loop="value => (audioLoop = value)"
          @update:engine="setEngine"
        />
      </section>

      <aside class="read-right">
        <section v-if="aiExplain" class="read-card read-ai-card" aria-label="AI 讲解">
          <ArticleAiExplain
            :explain-key="aiExplain.key"
            :text="aiExplain.text"
            :mode="aiExplain.mode"
            :heading="aiExplain.heading"
            :title="article.title"
            :language="setting.aiExplainLanguage"
            :cache="explainCache"
            @close="aiExplain = null"
            @word="speakWord"
            @explained="cacheExplanation"
          />
        </section>

        <section v-if="intro" class="read-card read-intro">
          <h2>导读</h2>
          <p>{{ intro }}</p>
        </section>

        <section class="read-card read-words">
          <h2>重点单词 <span>{{ cards.length }}</span></h2>
          <ul>
            <li v-for="card in cards" :key="card.word" class="read-word">
              <div class="read-word__head">
                <b>{{ card.word }}</b>
                <span v-if="card.phonetic" class="read-word__phonetic">/{{ card.phonetic }}/</span>
                <span class="read-word__actions">
                  <button type="button" :aria-label="`朗读 ${card.word}`" :title="`朗读 ${card.word}`" @click="speakWord(card.word)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z" /><path d="M15.6 8.6a4.6 4.6 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                  </button>
                  <button type="button" aria-label="读这个单词所在的句子" title="读例句" @click="playSentenceWithWord(card.word)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2a1 1 0 0 0 1.53.85l9.9-6.6a1 1 0 0 0 0-1.7l-9.9-6.6A1 1 0 0 0 8 5.4Z" /></svg>
                  </button>
                </span>
              </div>
              <p class="read-word__meaning">
                <em v-if="card.pos">{{ card.pos }}</em>
                {{ card.meaning || '—' }}
              </p>
              <p v-if="card.example" class="read-word__example">{{ card.example }}</p>
              <p v-if="card.exampleCn" class="read-word__example-cn">{{ card.exampleCn }}</p>
            </li>
            <li v-if="!cards.length" class="read-word is-empty">这篇还没有整理重点词。</li>
          </ul>
        </section>
      </aside>
    </template>
  </div>
</template>

<style scoped lang="scss">
.read-page {
  display: grid;
  /* .read-hint 这类渲染在网格内的提示需要独占整行；文章正文与右栏各占一列 */
  grid-template-columns: minmax(0, 1fr) 21.5rem;
  gap: 1.6rem;
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  /* 底部多留一段，播放条固定在视口底部也不会压住正文结尾 */
  padding: 1.6rem 1.6rem 9.5rem;
  box-sizing: border-box;
  align-items: start;
}

.read-page > .read-hint,
.read-page > .read-empty {
  grid-column: 1 / -1;
}

.read-hint {
  grid-column: 1 / -1;
  color: var(--color-sub-text);
  font-size: 0.85rem;

  &.is-error {
    color: #ef4444;
  }
}

.read-back {
  margin-left: 0.6rem;
  padding: 0.15rem 0.55rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
  color: var(--color-main-text);
  font-size: 0.74rem;
  cursor: pointer;
}

.read-left {
  min-width: 0;
}

.read-head {
  .read-kicker {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-sub-text);
  }

  h1 {
    margin-top: 0.35rem;
    font-size: 1.9rem;
    line-height: 1.25;
    font-family: var(--en-article-family);
    color: var(--color-main-text);
  }
}

.read-subtitle {
  margin-top: 0.3rem;
  font-size: 0.95rem;
  color: var(--color-sub-text);
  font-family: var(--zh-article-family);
}

.read-chapter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.7rem;
  font-size: 0.78rem;
  color: var(--color-sub-text);

  select {
    height: 1.9rem;
    max-width: 18rem;
    padding: 0 0.4rem;
    border-radius: 0.45rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    font-size: 0.82rem;
  }
}

/* AI 讲解入口 */
.read-tools {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.7rem;
  margin-left: 0.8rem;
}

.read-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 1.9rem;
  padding: 0 0.7rem;
  border: 1px solid var(--color-select-bg);
  border-radius: 0.45rem;
  background: transparent;
  color: var(--color-select-bg);
  font-size: 0.82rem;
  cursor: pointer;

  svg {
    font-size: 1rem;
  }

  &:hover {
    background: color-mix(in srgb, var(--color-select-bg) 12%, transparent);
  }

  &.is-on {
    background: color-mix(in srgb, var(--color-select-bg) 14%, transparent);
  }
}

.read-ai-link {
  font-size: 0.78rem;
  color: var(--color-sub-text);
  text-decoration: underline;

  &:hover {
    color: var(--color-main-text);
  }
}

.read-hint-inline {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: #b45309;
  line-height: 1.65;
}

/* 用纯 CSS 画一张封面占位图 */
.read-cover {
  position: relative;
  margin-top: 1.1rem;
  height: 190px;
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(160deg, #1e293b 0%, #312e81 55%, #0f172a 100%);
  border: 1px solid var(--color-line);
}

.read-cover__sky {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1.5px 1.5px at 18% 26%, rgba(255, 255, 255, 0.9), transparent),
    radial-gradient(1px 1px at 42% 18%, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(1.5px 1.5px at 68% 34%, rgba(255, 255, 255, 0.85), transparent),
    radial-gradient(1px 1px at 82% 16%, rgba(255, 255, 255, 0.6), transparent),
    radial-gradient(1.5px 1.5px at 30% 44%, rgba(255, 255, 255, 0.5), transparent);
}

.read-cover__moon {
  position: absolute;
  right: 18%;
  top: 24%;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 55%, #f59e0b);
  box-shadow: 0 0 42px rgba(251, 191, 36, 0.55);
}

.read-cover__ridge {
  position: absolute;
  left: -6%;
  right: -6%;
  bottom: -36px;
  height: 120px;
  border-radius: 50% 50% 0 0;
  background: linear-gradient(180deg, #0b1220, #05070c);

  &.is-back {
    bottom: -58px;
    background: linear-gradient(180deg, #16233b, #0b1220);
    opacity: 0.85;
  }
}

.read-cover__caption {
  position: absolute;
  left: 1rem;
  bottom: 0.85rem;
  font-size: 0.72rem;
  color: rgba(226, 232, 240, 0.82);
  letter-spacing: 0.04em;
}

.read-body {
  margin-top: 1.4rem;
  font-family: var(--en-article-family);
  font-size: 1.05rem;
  line-height: 1.9;
  color: var(--color-main-text);
}

.read-paragraph {
  position: relative;
  margin-bottom: 1.35rem;
}

/* 段落右上角的「AI」讲解按钮：默认半透明，悬停段落时点亮 */
.read-paragraph__ai {
  position: absolute;
  top: 0.1rem;
  right: -0.2rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--color-line);
  border-radius: 0.35rem;
  background: var(--color-card-bg);
  color: var(--color-sub-text);
  font-size: 0.66rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
  opacity: 0.45;
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover,
  &:focus-visible {
    opacity: 1;
    color: var(--color-select-bg);
    border-color: var(--color-select-bg);
  }
}

.read-paragraph:hover .read-paragraph__ai {
  opacity: 1;
}

.read-en {
  display: block;
}

/* 逐句朗读：整句可点，正在读的句子高亮 */
.read-sentence {
  cursor: pointer;
  border-radius: 0.2rem;
  /* 跟随滚动时给底部固定播放条让位 */
  scroll-margin-block: 9rem;
  transition:
    background-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    background: var(--color-second);
  }

  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }

  &.is-active {
    background: color-mix(in srgb, var(--color-select-bg) 12%, transparent);
    box-shadow: inset 0 -2px 0 var(--color-select-bg);
  }
}

.read-keyword {
  background: linear-gradient(180deg, transparent 62%, rgba(250, 204, 21, 0.55) 62%);
  color: inherit;
  padding: 0 0.05em;
  border-radius: 0.12em;
  font-weight: 600;
}

.read-cn {
  display: block;
  margin-top: 0.35rem;
  font-family: var(--zh-article-family);
  font-size: 0.9rem;
  line-height: 1.8;
  color: var(--color-sub-text);
}

/* AI 讲解打开时，逐句讲解直接贴在原文段落下 */
.read-sentence-notes {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.45rem;
  padding: 0.45rem 0.6rem;
  border-left: 2px solid color-mix(in srgb, var(--color-select-bg) 55%, transparent);
  border-radius: 0 0.4rem 0.4rem 0;
  background: color-mix(in srgb, var(--color-select-bg) 5%, transparent);
  font-family: var(--zh-article-family);
}

.read-sentence-note {
  display: block;
  font-size: 0.9rem;
  line-height: 1.75;
}

.read-sentence-note__cn {
  color: var(--color-main-text);
}

.read-sentence-note__tip {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.84rem;
  color: var(--color-sub-text);
}

.read-right {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: sticky;
  top: 1rem;
  align-self: start;
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  padding-right: 0.2rem;
}

/* AI 讲解卡片：贴在右栏顶部，与卡片之间留出间距，避免贴在一起像被裁掉 */
.read-ai-card {
  padding: 0;
  /* 不裁切：讲解正文自己滚动，卡片高度随内容走 */
  overflow: visible;
  order: -1;
  margin-bottom: 0.2rem;

  .ai-explain {
    position: static;
    top: auto;
    left: auto;
    right: auto;
    max-height: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    overflow: visible;
  }

  .ai-explain__body {
    max-height: min(62vh, 40rem);
  }

  .ai-explain__head {
    padding-top: 0.75rem;
  }
}

.read-card {
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  padding: 1rem 1.05rem;

  h2 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-main-text);
    display: flex;
    align-items: center;
    gap: 0.4rem;

    span {
      font-size: 0.76rem;
      font-weight: 500;
      color: var(--color-sub-text);
    }
  }
}

.read-intro p {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  line-height: 1.8;
  color: var(--color-sub-text);
  font-family: var(--zh-article-family);
}

.read-words ul {
  margin-top: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
}

.read-word {
  padding-bottom: 0.7rem;
  border-bottom: 1px dashed var(--color-line);

  &:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  &.is-empty {
    font-size: 0.84rem;
    color: var(--color-sub-text);
  }
}

.read-word__head {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex-wrap: wrap;

  b {
    font-size: 1rem;
    font-family: var(--word-font-family);
    color: var(--color-main-text);
  }
}

.read-word__actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;

  button {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--color-sub-text);
    cursor: pointer;

    svg {
      width: 0.85rem;
      height: 0.85rem;
      fill: currentColor;
    }

    &:hover {
      border-color: var(--color-line);
      background: var(--color-second);
      color: var(--color-main-text);
    }
  }
}

.read-word__phonetic {
  font-size: 0.78rem;
  color: var(--color-sub-text);
}

.read-word__meaning {
  margin-top: 0.2rem;
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--color-main-text);

  em {
    font-style: normal;
    font-size: 0.76rem;
    color: var(--color-sub-text);
    margin-right: 0.25rem;
  }
}

.read-word__example {
  margin-top: 0.25rem;
  font-size: 0.84rem;
  line-height: 1.65;
  color: var(--color-sub-text);
  font-family: var(--en-article-family);
}

.read-word__example-cn {
  margin-top: 0.1rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--color-sub-text);
  font-family: var(--zh-article-family);
}

@media (max-width: 1024px) {
  .read-page {
    grid-template-columns: minmax(0, 1fr);
    padding: 1rem 1rem 3rem;
  }

  .read-right {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .read-head h1 {
    font-size: 1.5rem;
  }
}
</style>
