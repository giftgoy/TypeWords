<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useReadingVocabulary } from '@/core/immersive/vocabulary.ts'
import { readingRequest } from '@/core/immersive/api.ts'
import { parseTargetWords, validateCoverage, studyMarkdown } from '@/core/immersive/studio.ts'
import { getDefaultArticle, getDefaultDict } from '@/core/types/func.ts'
import { genArticleSectionData } from '@/core/hooks/article.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { DictType } from '@/core/types/enum.ts'
import type { Word, Article } from '@/core/types/types.ts'
import ReadingModelSettings from '@/components/article/ReadingModelSettings.vue'
import { phraseTokenIndexes } from '@/core/immersive/phrases.ts'
import { nanoid } from 'nanoid'

const { sources, load } = useReadingVocabulary()
const store = useBaseStore()
const router = useRouter()
const source = ref('')
const words = ref<Word[]>([])
const search = ref('')
const input = ref('')
const error = ref('')
const busy = ref(false)
const loadingWords = ref(false)
const result = ref<Article | null>(null)
let savedId = ''
let wordRequest = 0
const visibleWords = computed(() => words.value.filter(w => w.word.toLowerCase().includes(search.value.toLowerCase())).slice(0, 100))
const chosen = computed(() => input.value.split(/[,，;；\n]+/).map(w => w.trim().toLowerCase()))
const previewParagraphs = computed(() => result.value?.sections.map((section, paragraph) => {
  const words = section.flatMap(sentence => sentence.words)
  const tokens = words.map(w => ({ text: w.word, space: w.nextSpace, kind: 'word' }))
  const indexes = new Set(result.value!.readingStudy!.vocabulary.filter(v => v.paragraph === paragraph).flatMap(v => phraseTokenIndexes(tokens, v.form, true).flat()))
  return words.map((word, i) => ({ ...word, target: indexes.has(i) }))
}) || [])
async function changeSource() {
  const ticket = ++wordRequest
  loadingWords.value = true
  try { const data = await load(source.value); if (ticket === wordRequest) words.value = data }
  catch (cause) { error.value = (cause as Error).message }
  finally { if (ticket === wordRequest) loadingWords.value = false }
}
function toggle(word: string) {
  input.value = chosen.value.includes(word.toLowerCase()) ? chosen.value.filter(w => w !== word.toLowerCase()).join(', ') : [...chosen.value.filter(Boolean), word].join(', ')
}
async function generate() {
  error.value = ''
  result.value = null
  savedId = ''
  busy.value = true
  try {
    const targets = parseTargetWords(input.value)
    const data = await readingRequest('generate', { words: targets.join(','), session: nanoid() })
    validateCoverage(targets, data.vocabulary)
    const article = getDefaultArticle({
      title: data.title, titleTranslate: data.titleTranslate || '',
      text: data.paragraphs.map(p => p.en).join('\n\n'), textTranslate: data.paragraphs.map(p => p.cn).join('\n\n'),
      readingStudy: { targets, vocabulary: data.vocabulary, phrases: data.phrases, theme: data.theme },
    })
    genArticleSectionData(article)
    result.value = article
  } catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
function openReader() {
  if (!result.value) return
  const id = 'reading-studio'
  let book = store.article.bookList.find(b => b.id === id)
  if (!book) {
    book = getDefaultDict({ id, name: '我的背诵短文', type: DictType.article, custom: true, language: 'en', translateLanguage: 'zh-CN', articles: [] })
    store.article.bookList.push(book)
  }
  if (savedId !== String(result.value.id)) {
    book.articles.push(result.value)
    book.length = book.articles.length
    savedId = String(result.value.id)
  }
  router.push(`/book/${id}?article=${result.value.id}&mode=immersion`)
}
function download() {
  const blob = new Blob([studyMarkdown(result.value!)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${result.value!.title}.md`; a.click()
  URL.revokeObjectURL(url)
}
</script>
<template>
  <main class="reading-studio">
    <NuxtLink to="/articles">返回文章</NuxtLink>
    <h1>用单词写一篇值得背诵的短文</h1>
    <p>选一组目标词，生成 120–180 词、B1–B2 难度的连贯短文，附自然翻译、语境释义与实用搭配。</p>
    <ReadingModelSettings />
    <form @submit.prevent="generate">
      <label>从词库选词<select v-model="source" @change="changeSource"><option value="">手动输入目标词</option><option v-for="item in sources" :key="item.key" :value="item.key">{{ item.name }}</option></select></label>
      <div v-if="source" class="source-words">
        <label>筛选词库<input v-model="search" placeholder="搜索要背诵的词" /></label>
        <p v-if="loadingWords" role="status">正在加载词库…</p>
        <div class="word-choices"><button v-for="word in visibleWords" :key="word.word" type="button" :aria-pressed="chosen.includes(word.word.toLowerCase())" @click="toggle(word.word)">{{ word.word }}</button></div>
        <p>显示前 100 个匹配词，点击选择；也可在下方补充任意词语。</p>
      </div>
      <label>目标单词<textarea v-model="input" rows="4" required placeholder="用逗号或换行分隔，例如：arrange, persuade, opportunity" /></label>
      <p>建议每篇 5–20 个目标词；过多的词可能无法在 180 词内自然覆盖。</p>
      <button class="primary" type="submit" :disabled="busy">{{ busy ? '正在编写与校验…' : '生成背诵短文' }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
    <article v-if="result" class="result">
      <h2>{{ result.title }}</h2>
      <p v-for="tokens in previewParagraphs" class="english"><template v-for="token in tokens"><strong v-if="token.target">{{ token.word }}</strong><template v-else>{{ token.word }}</template>{{ token.nextSpace ? ' ' : '' }}</template></p>
      <h3>中文翻译</h3><p v-for="p in result.textTranslate.split('\n\n')">{{ p }}</p>
      <h3>目标词清单</h3><ul><li v-for="v in result.readingStudy.vocabulary">{{ v.lemma }} → <strong>{{ v.form }}</strong>：{{ v.meaning }}</li></ul>
      <h3>值得背诵的搭配 / 句型</h3><ul><li v-for="p in result.readingStudy.phrases"><strong>{{ p.text }}</strong>：{{ p.meaning }}</li></ul>
      <p>{{ result.readingStudy.theme }}</p>
      <div class="actions"><button class="primary" @click="openReader">保存并进入沉浸式阅读</button><button @click="download">下载 Markdown</button></div>
    </article>
  </main>
</template>
<style scoped>
.reading-studio { max-width: 900px; margin: 0 auto; padding: 32px 24px 80px; color: var(--color-main-text); line-height: 1.7; }
h1 { font-size: 28px; margin: 20px 0 8px; }
h2 { font-size: 26px; } h3 { margin-top: 28px; }
form { margin-top: 28px; } label { display: grid; gap: 8px; margin-block: 16px; font-weight: 600; }
input, select, textarea { min-width: 0; padding: 10px 12px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-second); color: inherit; font: inherit; }
button { border: 1px solid var(--color-line); border-radius: 6px; padding: 8px 14px; cursor: pointer; background: var(--color-second); color: inherit; font: inherit; }
button[aria-pressed=true], .primary { background: var(--color-main-text); color: var(--color-second); }
button:disabled { opacity: .6; cursor: wait; }
.word-choices, .actions { display: flex; flex-wrap: wrap; gap: 8px; }
.word-choices { max-height: 200px; overflow: auto; }
.result { border-top: 1px solid var(--color-line); margin-top: 36px; padding-top: 20px; }
.english { font-family: var(--en-article-family); font-size: 19px; line-height: 1.9; }
[role=alert] { color: #b45309; }
@media(max-width:768px) { .reading-studio { padding: 20px 12px 48px; } h1 { font-size: 23px; } }
</style>
