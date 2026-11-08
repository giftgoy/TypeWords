<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BasePage } from '@/base'
import SyntaxSentence from '@/components/article/SyntaxSentence.vue'
import { DICT_LIST } from '@/core/config/env'
import { resourceWrap } from '@/core/utils'
import { readMarketCatalog, type MarketResource } from '@/core/utils/resource-market'
import { pairParagraph, type SyntaxSentence as SentenceModel } from '@/core/syntax/analyze'

useHead({ title: '语法精读 · TypeWords' })

type ArticleItem = {
  id: string | number
  title: string
  titleTranslate?: string
  text: string
  textTranslate?: string
}

const books = ref<MarketResource[]>([])
const bookId = ref('')
const articles = ref<ArticleItem[]>([])
const articleIndex = ref(0)
const loadingBooks = ref(true)
const loadingArticle = ref(false)
const error = ref('')

const showSyntax = ref(true)
const cnMode = ref<'hover' | 'always' | 'hidden'>('hover')
const route = useRoute()

const book = computed(() => books.value.find(item => String(item.id) === bookId.value))
const article = computed<ArticleItem | null>(() => articles.value[articleIndex.value] ?? null)

type Paragraph = { sentences: SentenceModel[] }
const paragraphs = computed<Paragraph[]>(() => {
  const current = article.value
  if (!current?.text) return []
  const enBlocks = current.text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  const cnBlocks = (current.textTranslate ?? '').split(/\n{2,}/).map(block => block.trim())
  return enBlocks.map((block, index) => ({ sentences: pairParagraph(block, cnBlocks[index] ?? '') }))
})

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(resourceWrap(url), { cache: 'no-cache', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`${response.status}`)
  return (await response.json()) as T
}

async function loadBooks() {
  loadingBooks.value = true
  error.value = ''
  try {
    const catalog = readMarketCatalog(await fetchJson(DICT_LIST.ARTICLE.ALL))
    books.value = catalog
    const wanted = String(route.query.book ?? '')
    const preferred = catalog.find(item => String(item.id) === wanted) ?? catalog.find(item => item.featured) ?? catalog[0]
    if (preferred) {
      bookId.value = String(preferred.id)
      await loadArticles(bookId.value)
      const wantedIndex = Number(route.query.index ?? '')
      if (Number.isFinite(wantedIndex) && wantedIndex >= 0 && wantedIndex < articles.value.length) {
        articleIndex.value = wantedIndex
      }
    }
  } catch (e) {
    error.value = `读物目录读取失败：${(e as Error).message}`
  } finally {
    loadingBooks.value = false
  }
}

async function loadArticles(id: string) {
  const target = books.value.find(item => String(item.id) === id)
  if (!target) return
  loadingArticle.value = true
  error.value = ''
  articles.value = []
  articleIndex.value = 0
  try {
    const data = await fetchJson<ArticleItem[]>(`/dicts/en/article/${target.url}`)
    articles.value = Array.isArray(data) ? data : []
  } catch (e) {
    error.value = `文章读取失败：${(e as Error).message}`
  } finally {
    loadingArticle.value = false
  }
}

function onBookChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  bookId.value = value
  void loadArticles(value)
}

onMounted(loadBooks)

watch(bookId, value => {
  if (value && !articles.value.length) void loadArticles(value)
})
</script>

<template>
  <BasePage>
    <div class="sr-page">
      <header class="sr-header">
        <div>
          <h1>语法精读</h1>
          <p>主语标蓝、谓语标红，从句和分词短语单独框成一块；中文默认藏起来，鼠标移上去才出现。</p>
        </div>
        <div class="sr-controls">
          <label class="sr-control">
            <span>读物</span>
            <select :value="bookId" @change="onBookChange">
              <option v-for="item in books" :key="item.id" :value="String(item.id)">
                {{ item.name }}
              </option>
            </select>
          </label>
          <label class="sr-control">
            <span>篇目</span>
            <select v-model.number="articleIndex" :disabled="!articles.length">
              <option v-for="(item, index) in articles" :key="item.id ?? index" :value="index">
                {{ index + 1 }}. {{ item.title }}
              </option>
            </select>
          </label>
          <label class="sr-control">
            <span>中文</span>
            <select v-model="cnMode">
              <option value="hover">悬停显示</option>
              <option value="always">常显</option>
              <option value="hidden">隐藏</option>
            </select>
          </label>
          <button
            type="button"
            class="sr-toggle"
            :class="{ 'is-on': showSyntax }"
            :aria-pressed="showSyntax"
            @click="showSyntax = !showSyntax"
          >
            {{ showSyntax ? '语法标注：开' : '语法标注：关' }}
          </button>
        </div>
      </header>

      <p v-if="loadingBooks" class="sr-hint">正在读取读物目录…</p>
      <p v-else-if="error" class="sr-hint is-error">{{ error }}</p>
      <p v-else-if="loadingArticle" class="sr-hint">正在读取文章…</p>

      <article v-if="article" class="sr-article">
        <header class="sr-article__head">
          <h2>{{ article.title }}</h2>
          <p v-if="article.titleTranslate">{{ article.titleTranslate }}</p>
          <ul class="sr-legend" v-if="showSyntax">
            <li><i class="is-subject"></i>主语</li>
            <li><i class="is-predicate"></i>谓语</li>
            <li><i class="is-modifier"></i>修饰成分</li>
          </ul>
        </header>

        <p v-for="(paragraph, index) in paragraphs" :key="index" class="sr-paragraph">
          <SyntaxSentence
            v-for="(sentence, sentenceIndex) in paragraph.sentences"
            :key="sentenceIndex"
            :sentence="sentence"
            :show-syntax="showSyntax"
            :cn-mode="cnMode"
          />
        </p>
      </article>

      <p v-else-if="!loadingBooks && !error" class="sr-hint">这本读物还没有文章。</p>
    </div>
  </BasePage>
</template>

<style scoped lang="scss">
.sr-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 3rem;
}

.sr-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;

  h1 {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--color-main-text);
  }

  p {
    margin-top: 0.3rem;
    font-size: 0.78rem;
    color: var(--color-sub-text);
    max-width: 42rem;
    line-height: 1.6;
  }
}

.sr-controls {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.sr-control {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.66rem;
  color: var(--color-sub-text);

  select {
    height: 1.9rem;
    max-width: 12rem;
    padding: 0 0.4rem;
    border-radius: 0.45rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    font-size: 0.74rem;
  }
}

.sr-toggle {
  height: 1.9rem;
  padding: 0 0.7rem;
  border-radius: 0.45rem;
  border: 1px solid var(--color-line);
  background: var(--color-second);
  color: var(--color-sub-text);
  font-size: 0.74rem;
  cursor: pointer;

  &.is-on {
    background: var(--color-card-bg);
    color: var(--color-main-text);
    font-weight: 600;
  }
}

.sr-hint {
  font-size: 0.8rem;
  color: var(--color-sub-text);

  &.is-error {
    color: #ef4444;
  }
}

.sr-article {
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  padding: 1.4rem 1.6rem 1.8rem;
}

.sr-article__head {
  margin-bottom: 1.2rem;

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--color-main-text);
  }

  p {
    margin-top: 0.25rem;
    font-size: 0.82rem;
    color: var(--color-sub-text);
  }
}

.sr-legend {
  display: flex;
  gap: 0.9rem;
  margin-top: 0.6rem;
  font-size: 0.68rem;
  color: var(--color-sub-text);

  li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  i {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 0.15rem;
    display: inline-block;
  }

  .is-subject {
    background: #1d4ed8;
  }

  .is-predicate {
    background: #dc2626;
  }

  .is-modifier {
    background: rgba(99, 102, 241, 0.4);
    border-left: 2px solid rgba(99, 102, 241, 0.7);
  }
}

.sr-paragraph {
  font-family: var(--en-article-family);
  font-size: 1.02rem;
  line-height: 1.95;
  color: var(--color-main-text);
  margin-bottom: 1.1rem;

  &:last-child {
    margin-bottom: 0;
  }
}

@media (max-width: 768px) {
  .sr-article {
    padding: 1rem 0.9rem 1.2rem;
  }

  .sr-paragraph {
    font-size: 0.96rem;
    line-height: 1.85;
  }
}
</style>
