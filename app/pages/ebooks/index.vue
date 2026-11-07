<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { ebooksRequest, fileSize, type EbookCatalog } from '@/core/ebooks/client'
import '@/assets/css/ebooks.scss'

useHead({ title: '外刊资源 · TypeWords' })
const catalog = shallowRef<EbookCatalog>()
const error = ref('')
const loading = ref(false)
const query = ref('')
const publication = ref('')
const limit = ref(12)
const names: Record<string, string> = {
  '01_economist': 'The Economist',
  '02_new_yorker': 'The New Yorker',
  '04_atlantic': 'The Atlantic',
  '05_wired': 'WIRED',
}
const groups = computed(() => [...new Map(catalog.value?.issues.map(v => [v.publication, v.name]) || [])])
const issues = computed(() =>
  (catalog.value?.issues || []).filter(
    v =>
      (!publication.value || v.publication === publication.value) &&
      (!query.value.trim() || (v.title + names[v.publication]).toLowerCase().includes(query.value.trim().toLowerCase()))
  )
)
watch([query, publication], () => {
  limit.value = 12
})
async function load(refresh = false) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    catalog.value = await ebooksRequest<EbookCatalog>('/catalog', refresh)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())
</script>

<template>
  <main class="ebooks-page">
    <NuxtLink to="/articles">← 返回文章</NuxtLink>
    <h1>从一篇外刊，读到真实的表达。</h1>
    <p class="eb-muted">
      按期选择经济学人、纽约客、大西洋月刊或连线。EPUB 可按篇阅读、分析词汇所属词典，并加入文章书架。
    </p>
    <div class="eb-toolbar">
      <label>查找期刊<input v-model="query" placeholder="刊物名称或日期，如 2026-11" /></label
      ><button :disabled="loading" @click="load(true)">{{ loading ? '正在读取…' : '更新来源目录' }}</button
      ><a
        href="https://github.com/giftgoy/awesome-english-ebooks"
        target="_blank"
        rel="noopener noreferrer"
        class="eb-muted"
        >查看资源仓库 ↗</a
      >
    </div>
    <p v-if="error || catalog?.error" class="eb-status eb-error" role="status">
      {{ error || catalog?.error }} <button :disabled="loading" @click="load(true)">重试</button>
    </p>
    <template v-if="catalog">
      <div class="eb-tabs" aria-label="按刊物筛选">
        <button :aria-pressed="!publication" @click="publication = ''">全部 {{ catalog.issues.length }} 期</button
        ><button v-for="[id, name] in groups" :key="id" :aria-pressed="publication === id" @click="publication = id">
          {{ name }} {{ catalog.issues.filter(v => v.publication === id).length }}
        </button>
      </div>
      <p class="eb-muted">
        {{ issues.length }} 期可选 · 按封面日期从新到旧排列<span v-if="catalog.checkedAt">
          · 最近检查 {{ new Date(catalog.checkedAt).toLocaleString() }}</span
        ><span v-else> · 当前使用已保存目录，可点击更新检查新刊</span>
      </p>
      <div class="eb-grid">
        <article v-for="issue in issues.slice(0, limit)" :key="issue.id" class="eb-card">
          <div class="eb-cover" aria-hidden="true">{{ names[issue.publication] }}</div>
          <h2>{{ issue.name }}</h2>
          <p>{{ issue.date }}</p>
          <p class="eb-muted">EPUB {{ fileSize(issue.files.find(f => f.format === 'epub')!.size) }} · 按需缓存</p>
          <div class="eb-files">
            <a v-for="file in issue.files" :key="file.format" :href="file.url" target="_blank" rel="noopener noreferrer"
              >{{ file.format === 'audio-list' ? '音频清单' : file.format.toUpperCase() }} ↗</a
            >
          </div>
          <NuxtLink class="eb-button eb-primary" :to="`/ebooks/${issue.id}`">下载并阅读 →</NuxtLink>
        </article>
      </div>
      <p v-if="!issues.length" class="eb-status">没有符合条件的期刊，可以更换日期或刊物筛选。</p>
      <div class="eb-actions">
        <button v-if="issues.length > limit" @click="limit += 12">再显示 12 期</button
        ><span class="eb-muted">已显示 {{ Math.min(limit, issues.length) }}/{{ issues.length }}</span>
      </div>
    </template>
  </main>
</template>
