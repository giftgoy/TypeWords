<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Toast } from '@/base'
import { DICT_LIST } from '@/core/config/env'
import { useBaseStore } from '@/core/stores/base'
import { useRuntimeStore } from '@/core/stores/runtime'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { getDefaultDict } from '@/core/types/func'
import { DictType } from '@/core/types/enum'
import type { Dict } from '@/core/types/types'
import { resourceWrap } from '@/core/utils'
import {
  READING_LEVELS,
  addResourceToLibrary,
  filterMarketResources,
  findInstalledResource,
  readMarketCatalog,
  readMarketContent,
  type MarketKind,
  type MarketResource,
} from '@/core/utils/resource-market'

const props = defineProps<{ kind: MarketKind }>()
const store = useBaseStore()
const runtimeStore = useRuntimeStore()
const persistence = useDataSyncPersistence()
const router = useRouter()
const resources = shallowRef<MarketResource[]>([])
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const category = ref('')
const level = ref('')
const installedOnly = ref(false)
const sort = ref('recommended')
const pending = ref(new Set<string>())
const dialog = ref<HTMLDialogElement>()
const selected = shallowRef<MarketResource | null>(null)
const preview = shallowRef<Partial<Dict> | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const contentCache = new Map<string, Partial<Dict>>()
const words = computed(() => props.kind === 'word')
const noun = computed(() => (words.value ? '词典' : '文章集'))
const unit = computed(() => (words.value ? '词' : '篇'))
const library = computed(() => (words.value ? store.word.bookList : store.article.bookList))
const installedCount = computed(() => resources.value.filter(item => installed(item)).length)
const totalContent = computed(() => resources.value.reduce((count, item) => count + item.length, 0))
const categories = computed(() => [...new Set(resources.value.map(item => item.category))])
const visibleResources = computed(() =>
  filterMarketResources(
    resources.value,
    {
      query: query.value,
      category: category.value,
      level: level.value,
      installedOnly: installedOnly.value,
      sort: sort.value,
    },
    library.value
  )
)
const activeLevel = computed(() => READING_LEVELS.find(item => item.value === level.value))

function installed(item: MarketResource) {
  return findInstalledResource(item, library.value)
}
function countCategory(value: string) {
  return resources.value.filter(item => item.category === value).length
}
function resetFilters() {
  query.value = ''
  category.value = ''
  level.value = ''
  installedOnly.value = false
}
async function loadCatalog() {
  loading.value = true
  loadError.value = ''
  try {
    const url = words.value ? DICT_LIST.WORD.ALL : DICT_LIST.ARTICLE.ALL
    const response = await fetch(resourceWrap(url), { cache: 'no-cache', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`目录读取失败（${response.status}）`)
    const catalog = readMarketCatalog(await response.json())
    // 每日自动拉取的文章（由 articles 容器写入 feed 目录），失败了不影响内置资源
    if (!words.value) {
      try {
        const feed = await fetch(resourceWrap('/dicts/en/article/feed/index.json'), { cache: 'no-cache', signal: AbortSignal.timeout(8000) })
        if (feed.ok) {
          const extra = readMarketCatalog(await feed.json())
          const known = new Set(catalog.map(item => item.id))
          catalog.push(...extra.filter(item => !known.has(item.id)))
        }
      } catch {
        /* feed 未启用时忽略 */
      }
    }
    resources.value = catalog
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '资源目录暂时无法读取。'
  } finally {
    loading.value = false
  }
}
onMounted(loadCatalog)
watch(
  () => props.kind,
  () => {
    resetFilters()
    resources.value = []
    contentCache.clear()
    loadCatalog()
  }
)

async function loadContent(item: MarketResource) {
  const key = `${props.kind}:${item.id}`
  if (contentCache.has(key)) return contentCache.get(key)!
  const url = resourceWrap(`/dicts/${item.language}/${props.kind}/${item.url.split('/').map(encodeURIComponent).join('/')}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`资源读取失败（${response.status}），请重试。`)
  const data = readMarketContent(item, props.kind, await response.json())
  contentCache.set(key, data)
  return data
}
async function loadPreview(item: MarketResource) {
  previewLoading.value = true
  previewError.value = ''
  preview.value = null
  try {
    const data = await loadContent(item)
    if (selected.value?.id === item.id) preview.value = data
  } catch (error) {
    if (selected.value?.id === item.id)
      previewError.value = error instanceof Error ? error.message : '预览加载失败，请重试。'
  } finally {
    if (selected.value?.id === item.id) previewLoading.value = false
  }
}
async function showPreview(item: MarketResource) {
  selected.value = item
  await nextTick()
  dialog.value?.showModal()
  await loadPreview(item)
}
async function addResource(item: MarketResource) {
  const key = String(item.id)
  if (!store.load || pending.value.has(key) || installed(item)) return
  pending.value.add(key)
  try {
    const data = await loadContent(item)
    const dict = getDefaultDict({ ...data, type: words.value ? DictType.word : DictType.article })
    // Recheck after fetching; never replace an existing resource or its learning record.
    if (addResourceToLibrary(dict, library.value)) {
      await persistence.saveDictState()
      Toast.success(`已添加到我的${words.value ? '词典' : '书籍'}`)
    }
  } catch (error) {
    Toast.error(error instanceof Error ? error.message : '添加失败，请稍后重试。')
  } finally {
    pending.value.delete(key)
  }
}
function openResource(item: MarketResource) {
  runtimeStore.editDict = getDefaultDict(installed(item) || item)
  dialog.value?.close()
  router.push(words.value ? { path: '/dict', query: { from: 'list', id: String(item.id) } } : `/book/${item.id}`)
}
</script>

<template>
  <main class="resource-market">
    <header class="market-header">
      <div class="market-eyebrow"><span class="eyebrow-dot"></span> TYPE WORDS · 资源市场</div>
      <div class="market-title-row">
        <div>
          <h1>{{ words ? '为下一次进步，选一本词典。' : '找到刚好适合你的下一篇。' }}</h1>
          <p class="market-intro">
            {{
              words
                ? '从日常词汇到专业表达，把想学的内容加入你的学习库。'
                : '从简单日常到深度阅读，在有中文对照的故事和观点中循序渐进。'
            }}
          </p>
        </div>
        <NuxtLink :to="words ? '/words' : '/articles'" class="return-link"
          >返回{{ words ? '单词' : '文章' }} <span aria-hidden="true">↗</span></NuxtLink
        >
      </div>
      <div class="market-nav-row">
        <nav class="market-tabs" aria-label="资源类型">
          <NuxtLink to="/dict-list" :class="{ active: words }"><span aria-hidden="true">Aa</span> 词典市场</NuxtLink>
          <NuxtLink to="/book-list" :class="{ active: !words }"><span aria-hidden="true">¶</span> 分级文章</NuxtLink>
        </nav>
        <span v-if="!loading && !loadError" class="catalog-summary"
          >{{ resources.length }} 本{{ noun }}<i></i>{{ totalContent.toLocaleString() }} {{ unit }}内容</span
        >
      </div>
    </header>
    <div class="market-body">
      <aside class="market-sidebar" aria-label="筛选资源">
        <p class="filter-heading">我的资源</p>
        <button
          class="sidebar-button"
          :class="{ selected: !installedOnly }"
          :aria-pressed="!installedOnly"
          @click="installedOnly = false"
        >
          <span>探索全部</span><span>{{ resources.length }}</span>
        </button>
        <button
          class="sidebar-button"
          :class="{ selected: installedOnly }"
          :aria-pressed="installedOnly"
          @click="installedOnly = true"
        >
          <span>已添加</span><span>{{ installedCount }}</span>
        </button>
        <p class="filter-heading category-heading">按主题浏览</p>
        <button
          class="sidebar-button"
          :class="{ selected: !category }"
          :aria-pressed="!category"
          @click="category = ''"
        >
          <span>全部主题</span>
        </button>
        <button
          v-for="item in categories"
          :key="item"
          class="sidebar-button"
          :class="{ selected: category === item }"
          :aria-pressed="category === item"
          @click="category = item"
        >
          <span>{{ item }}</span
          ><span>{{ countCategory(item) }}</span>
        </button>
        <div class="sidebar-note">
          <span class="note-symbol" aria-hidden="true">{{ words ? 'Aa' : 'A → C' }}</span
          ><strong>{{ words ? '按自己的节奏来' : '难度刚好，进步更好' }}</strong>
          <p>
            {{
              words
                ? '先预览，再添加。添加资源后，可在单词页继续学习。'
                : '从能轻松读懂大意的级别开始，再逐步挑战下一阶。'
            }}
          </p>
        </div>
      </aside>
      <section :id="words ? 'word-market-list' : undefined" class="market-content" aria-label="资源列表">
        <div class="market-toolbar">
          <label class="market-search"
            ><svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" /></svg
            ><input
              v-model="query"
              type="search"
              :aria-label="`搜索${noun}`"
              :placeholder="words ? '搜索词典、考试或使用场景…' : '搜索文章集、主题或级别…'"
          /></label>
          <label class="sort-control"
            ><span class="sr-only">排序方式</span
            ><select v-model="sort" aria-label="排序方式">
              <option value="recommended">推荐排序</option>
              <option value="count-asc">内容从少到多</option>
              <option value="count-desc">内容从多到少</option>
              <option value="name">名称排序</option>
            </select></label
          >
        </div>
        <div v-if="!words" class="level-filter">
          <div class="level-filter-heading"><strong>选择阅读级别</strong><span>CEFR 参考难度</span></div>
          <div class="level-buttons" aria-label="阅读级别">
            <button :class="{ active: !level }" :aria-pressed="!level" @click="level = ''">全部级别</button>
            <button
              v-for="item in READING_LEVELS"
              :key="item.value"
              :class="{ active: level === item.value }"
              :aria-pressed="level === item.value"
              :aria-label="`${item.value} ${item.name}`"
              @click="level = item.value"
            >
              <b>{{ item.value }}</b> {{ item.name }}
            </button>
          </div>
          <p v-if="activeLevel" class="level-description">{{ activeLevel.value }} · {{ activeLevel.description }}</p>
          <p v-else class="level-description">A1–C2 为编写时的参考分级，非官方评级。可先预览内容，再选择合适的难度。</p>
        </div>
        <div class="results-heading">
          <h2>
            {{ installedOnly ? '已加入学习库' : category || '发现你的下一本'
            }}<span>{{ visibleResources.length }}</span>
          </h2>
          <button v-if="query || category || level || installedOnly" class="reset-button" @click="resetFilters">
            清除筛选
          </button>
        </div>
        <div v-if="loading" class="market-state" role="status">
          <span class="market-spinner"></span>
          <p>正在整理资源…</p>
        </div>
        <div v-else-if="loadError" class="market-state" role="alert">
          <h3>暂时无法打开资源目录</h3>
          <p>{{ loadError }}</p>
          <button class="market-button primary" @click="loadCatalog">重新加载</button>
        </div>
        <div v-else-if="!visibleResources.length" class="market-state">
          <span class="empty-symbol" aria-hidden="true">⌕</span>
          <h3>{{ installedOnly ? '这里还没有符合条件的资源' : '没有找到匹配的资源' }}</h3>
          <p>试试其他关键词，或清除筛选继续发现。</p>
          <button class="market-button" @click="resetFilters">浏览全部资源</button>
        </div>
        <div v-else class="resource-grid">
          <article v-for="item in visibleResources" :key="item.id" class="resource-card" :data-resource-id="item.id">
            <div class="card-top">
              <span class="resource-icon" :class="`accent-${item.accent || 'indigo'}`" aria-hidden="true">{{
                item.icon || 'Aa'
              }}</span
              ><span v-if="installed(item)" class="installed-badge">✓ 已添加</span
              ><span v-else-if="item.featured" class="featured-badge">推荐</span>
            </div>
            <button class="resource-title" @click="showPreview(item)">{{ item.name }}</button>
            <p class="resource-description">{{ item.description }}</p>
            <p v-if="item.url.startsWith('feed/')" class="text-xs color-gray" role="status">
              最近检查：{{ item.checkedAt ? new Date(item.checkedAt).toLocaleString() : '暂无记录' }}
              · {{ item.fetchStatus === 'checking' ? '正在检查来源，先展示已有内容' : item.fetchStatus === 'error' ? '检查失败，保留历史内容' : '来源内容，不保证每日有新稿' }}
            </p>
            <div class="resource-tags">
              <span v-if="item.level" class="level-tag">{{ item.level }}</span
              ><span v-for="tag in item.tags.slice(0, 2)" :key="tag">{{ tag }}</span>
            </div>
            <div class="resource-meta">
              <strong
                >{{ item.length.toLocaleString() }} <span>{{ unit }}</span></strong
              ><span v-if="item.wordRange">每篇 {{ item.wordRange[0] }}–{{ item.wordRange[1] }} 词</span
              ><span v-else>{{ item.category }}</span>
            </div>
            <div class="card-footer">
              <button class="preview-button" :aria-label="`预览 ${item.name}`" @click="showPreview(item)">
                预览 <span aria-hidden="true">↗</span></button
              ><button
                v-if="installed(item)"
                class="market-button added"
                :aria-label="`查看 ${item.name}`"
                @click="openResource(item)"
              >
                查看{{ noun }}</button
              ><button
                v-else
                class="market-button primary"
                :disabled="!store.load || pending.has(String(item.id))"
                :aria-label="`添加 ${item.name}`"
                @click="addResource(item)"
              >
                {{ pending.has(String(item.id)) ? '添加中…' : '+ 添加' }}
              </button>
            </div>
          </article>
        </div>
        <p v-if="!loading && !loadError" class="market-footnote">
          {{
            words
              ? '所有词库均已备好，按需添加到你的学习库。资源来源与许可可在预览中查看。'
              : '新增分级文章均为原创双语短文，可用于跟打、阅读与默写。'
          }}
        </p>
      </section>
    </div>
    <dialog
      ref="dialog"
      class="resource-preview"
      aria-labelledby="preview-title"
      @close="selected = null"
      @click="
        event => {
          if (event.target === dialog) dialog?.close()
        }
      "
    >
      <div v-if="selected" class="preview-inner">
        <button class="preview-close" aria-label="关闭预览" @click="dialog?.close()">×</button>
        <div class="preview-heading">
          <span class="resource-icon" :class="`accent-${selected.accent || 'indigo'}`" aria-hidden="true">{{
            selected.icon || 'Aa'
          }}</span>
          <div>
            <span class="preview-eyebrow">{{ noun }}预览</span>
            <h2 id="preview-title">{{ selected.name }}</h2>
          </div>
        </div>
        <p class="preview-description">{{ selected.description }}</p>
        <div class="preview-facts">
          <span>{{ preview?.length || selected.length }} {{ unit }}</span
          ><span v-if="selected.level"
            >{{ selected.level }} · {{ READING_LEVELS.find(item => item.value === selected?.level)?.name }}</span
          ><span>{{ selected.source }}</span>
        </div>
        <div v-if="selected.learningFocus" class="learning-focus">
          <strong>练习重点</strong>
          <p>{{ selected.learningFocus }}</p>
        </div>
        <div v-if="previewLoading" class="market-state" role="status">
          <span class="market-spinner"></span>
          <p>正在读取真实内容…</p>
        </div>
        <div v-else-if="previewError" class="market-state" role="alert">
          <p>{{ previewError }}</p>
          <button class="market-button" @click="loadPreview(selected)">重试预览</button>
        </div>
        <div v-else-if="preview" class="preview-sample">
          <h3>{{ words ? '词条选读 · 前 5 词' : '篇目与试读' }}</h3>
          <dl v-if="words" class="sample-words">
            <div v-for="word in preview.words?.slice(0, 5)" :key="word.word">
              <dt>
                {{ word.word }} <small v-if="word.phonetic0">/{{ word.phonetic0 }}/</small>
              </dt>
              <dd>{{ word.trans.map(item => `${item.pos} ${item.cn}`.trim()).join('；') }}</dd>
            </div>
          </dl>
          <template v-else
            ><ol class="sample-titles">
              <li v-for="article in preview.articles" :key="article.id">
                <span>{{ article.title }}</span
                ><small>{{ article.titleTranslate }}</small>
              </li>
            </ol>
            <div v-if="preview.articles?.[0]" class="sample-reading">
              <h4>{{ preview.articles[0].title }}</h4>
              <p lang="en">{{ preview.articles[0].text.split('\n\n')[0] }}</p>
              <p class="sample-translation">{{ preview.articles[0].textTranslate?.split('\n\n')[0] }}</p>
            </div></template
          >
        </div>
        <div class="preview-source">
          <span>{{ selected.levelNote || '添加后可在学习页选择模式、每日词数和开始位置。' }}</span
          ><a v-if="selected.sourceUrl" :href="selected.sourceUrl" target="_blank" rel="noopener noreferrer"
            >查看来源 ↗</a
          ><a
            v-if="selected.license"
            :href="
              resourceWrap(
                selected.license === 'CC0-1.0'
                  ? '/resource-licenses/original-readers-CC0.txt'
                  : '/resource-licenses/qwerty-learner-GPL-3.0.txt'
              )
            "
            target="_blank"
            rel="noopener noreferrer"
            >{{ selected.license }}</a
          >
        </div>
        <div class="preview-actions">
          <button class="market-button" @click="dialog?.close()">继续浏览</button
          ><button v-if="installed(selected)" class="market-button primary" @click="openResource(selected)">
            查看{{ noun }} →</button
          ><button
            v-else
            class="market-button primary"
            :disabled="!store.load || previewLoading || !!previewError || pending.has(String(selected.id))"
            @click="addResource(selected)"
          >
            {{ pending.has(String(selected.id)) ? '添加中…' : `添加到我的${words ? '词典' : '书籍'}` }}
          </button>
        </div>
      </div>
    </dialog>
  </main>
</template>

<style scoped lang="scss" src="../assets/css/resource-market.scss"></style>
