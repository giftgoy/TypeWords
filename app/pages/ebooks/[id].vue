<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ebooksRequest, fileSize, type EbookStatus } from '@/core/ebooks/client'
import { getDefaultArticle, getDefaultDict } from '@/core/types/func'
import { genArticleSectionData } from '@/core/hooks/article'
import { DictType } from '@/core/types/enum'
import { useBaseStore } from '@/core/stores/base'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import type { Article } from '@/core/types/types'
import ImmersiveArticle from '@/components/article/ImmersiveArticle.vue'
import '@/assets/css/ebooks.scss'

useHead({ title: '外刊阅读与词汇分析 · TypeWords' })
const route = useRoute()
const router = useRouter()
const base = useBaseStore()
const persistence = useDataSyncPersistence()
const status = shallowRef<EbookStatus>()
const article = shallowRef<Article>()
const selected = ref('')
const chapterQuery = ref('')
const error = ref('')
const chapterError = ref('')
const message = ref('')
const saving = ref(false)
const fetchingChapter = ref(false)
const issueId = String(route.params.id)
const bookId = 'ebooks-' + issueId
const chapters = computed(() =>
  (status.value?.chapters || []).filter(
    v => !chapterQuery.value || v.title.toLowerCase().includes(chapterQuery.value.toLowerCase())
  )
)
const imported = computed(
  () =>
    !!article.value &&
    base.article.bookList.some(b => b.id === bookId && b.articles.some(a => a.id === article.value!.id))
)
const percent = computed(() =>
  status.value?.total ? Math.min(100, Math.floor((status.value.received * 100) / status.value.total)) : 0
)
let disposed = false
let checking = false
let chapterRequest = 0
let timer: ReturnType<typeof setInterval>

async function check(start = false) {
  if (checking) return
  checking = true
  try {
    const data = await ebooksRequest<EbookStatus>(`/issues/${issueId}`, start)
    if (disposed) return
    status.value = data
    error.value = ''
    if (data.status === 'idle') {
      checking = false
      await check(true)
      return
    }
    if (data.status === 'ready' && !selected.value && data.chapters?.length) {
      const requested = String(route.query.chapter || '')
      await choose(data.chapters.find(c => c.id === requested)?.id || data.chapters[0].id)
    }
  } catch (e: any) {
    if (!disposed) error.value = e.message
  } finally {
    checking = false
  }
}
async function choose(id: string) {
  const ticket = ++chapterRequest
  selected.value = id
  article.value = undefined
  message.value = ''
  chapterError.value = ''
  fetchingChapter.value = true
  try {
    const data = await ebooksRequest<Partial<Article> & { id: string }>(`/issues/${issueId}/chapters/${id}`)
    if (disposed || ticket !== chapterRequest) return
    const next = getDefaultArticle({ ...data, id: `ebook-${issueId}-${id}` })
    genArticleSectionData(next)
    article.value = next
    await router.replace({ query: { chapter: id } })
  } catch (e: any) {
    if (!disposed && ticket === chapterRequest) chapterError.value = e.message
  } finally {
    if (ticket === chapterRequest) fetchingChapter.value = false
  }
}
async function addToLibrary() {
  if (!article.value || imported.value || saving.value || !base.load) return
  saving.value = true
  message.value = ''
  try {
    let book = base.article.bookList.find(b => b.id === bookId)
    if (!book) {
      book = getDefaultDict({
        id: bookId,
        sourceId: bookId,
        name: status.value!.issue.title,
        description: '来源：' + status.value!.issue.sourceUrl,
        type: DictType.article,
        custom: true,
        language: 'en',
        category: '外刊阅读',
        articles: [],
      })
      base.article.bookList.push(book)
    }
    if (!book.articles.some(a => a.id === article.value!.id)) {
      book.articles.push(getDefaultArticle(article.value))
      book.length = book.articles.length
      book.complete = false
    }
    await persistence.saveDictState(base.$state, { pullWhenRemoteNewer: false })
    message.value = '已加入文章书架，可以继续阅读或进入跟打练习。'
  } catch {
    message.value = '已加入本机书架，同步尚未确认，请留意学习数据保存状态。'
  } finally {
    saving.value = false
  }
}
onMounted(() => {
  void check()
  timer = setInterval(() => {
    if (status.value?.status === 'loading') void check()
  }, 1000)
})
onUnmounted(() => {
  disposed = true
  chapterRequest++
  clearInterval(timer)
})
</script>

<template>
  <main class="ebooks-page">
    <NuxtLink to="/ebooks">← 外刊资源</NuxtLink>
    <h1>{{ status?.issue.title || '正在读取这份期刊…' }}</h1>
    <div v-if="status" class="eb-files">
      <a :href="status.issue.sourceUrl" target="_blank" rel="noopener noreferrer">来源仓库 ↗</a
      ><a
        v-for="file in status.issue.files"
        :key="file.format"
        :href="file.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ file.format === 'audio-list' ? '音频清单' : '原始 ' + file.format.toUpperCase() }}（{{
          fileSize(file.size)
        }}）↗</a
      >
    </div>
    <section v-if="status?.status === 'loading'" class="eb-status" role="status">
      <h2>正在下载并解析 EPUB</h2>
      <p>
        已下载 {{ fileSize(status.received)
        }}<span v-if="status.total"> / {{ fileSize(status.total) }} · {{ percent }}%</span
        >。资源会缓存在本机，离开页面后仍会继续。
      </p>
      <progress :value="status.total ? status.received : undefined" :max="status.total || 1"></progress>
      <p class="eb-muted">下载完成后按篇显示英文正文。再次打开同一期会直接使用缓存。</p>
    </section>
    <p v-if="error || status?.status === 'error'" class="eb-status eb-error" role="alert">
      {{ error || status?.error }} <button @click="check(true)">重试下载</button>
    </p>
    <template v-if="status?.status === 'ready'">
      <div class="eb-toolbar">
        <label>查找篇目<input v-model="chapterQuery" placeholder="输入英文标题" /></label
        ><span class="eb-muted"
          >{{ status.chapters?.length }} 篇正文 · 保留原书顺序 · 提取文字，不含图片与原始版式</span
        >
      </div>
      <div class="eb-reader">
        <nav class="eb-chapters" aria-label="本期文章目录">
          <button
            v-for="(chapter, i) in chapters"
            :key="chapter.id"
            :aria-pressed="selected === chapter.id"
            @click="choose(chapter.id)"
          >
            <span>{{ i + 1 }}. {{ chapter.title }}</span
            ><small>{{ chapter.wordCount }} 词</small>
          </button>
          <p v-if="!chapters.length">没有匹配的篇目。</p>
        </nav>
        <div class="eb-content">
          <p v-if="fetchingChapter" role="status">正在读取正文…</p>
          <p v-if="chapterError" class="eb-status eb-error" role="alert">
            {{ chapterError }} <button @click="choose(selected)">重试</button>
          </p>
          <template v-if="article"
            ><h2>{{ article.title }}</h2>
            <p class="eb-muted">{{ status.issue.title }} · 英文原文</p>
            <div class="eb-actions">
              <button class="eb-primary" :disabled="saving || imported || !base.load" @click="addToLibrary">
                {{ saving ? '正在保存…' : imported ? '已加入文章书架' : '将这篇加入文章书架' }}</button
              ><NuxtLink v-if="imported" class="eb-button" :to="`/book/${bookId}`">在书架查看 →</NuxtLink>
            </div>
            <p v-if="message" role="status">{{ message }}</p>
            <ImmersiveArticle :key="article.id" :article="article" :show-translate="false"
          /></template>
        </div>
      </div>
    </template>
  </main>
</template>
