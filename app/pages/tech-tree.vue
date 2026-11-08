<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TechTreeGraph from '@/components/TechTreeGraph.vue'
import TechTreeFlow from '@/components/TechTreeFlow.vue'
import TechTreeMetro from '@/components/TechTreeMetro.vue'
import TechStarMap from '@/components/TechStarMap.vue'
import { DICT_LIST } from '@/core/config/env'
import { useBaseStore } from '@/core/stores/base'
import type { Dict } from '@/core/types/types'
import { resourceWrap } from '@/core/utils'
import { readMarketCatalog, type MarketResource } from '@/core/utils/resource-market'
import { buildStars, masteryScore, STAR_LEVEL_LABEL, type Star } from '@/core/tech-tree/galaxy'
import {
  computeLanes,
  computeTiers,
  LIT_THRESHOLD,
  TREE_NODES,
  type TreeNodeDef,
  type TreeNodeState,
  type TreeNodeView,
} from '@/core/tech-tree/tree'

useHead({ title: '科技树 · TypeWords' })

const router = useRouter()
const route = useRoute()
const store = useBaseStore()

type ViewName = 'metro' | 'stars' | 'canvas' | 'graph'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'metro', label: '地铁图' },
  { id: 'stars', label: '单词星图' },
  { id: 'canvas', label: '画布' },
  { id: 'graph', label: '横向图' },
]

/** 默认是词典地铁图；?view=stars|canvas|graph 可直达其他视图 */
const view = computed<ViewName>(() => {
  const value = String(route.query.view ?? '')
  return (VIEWS.some(item => item.id === value) ? value : 'metro') as ViewName
})
const canvasRef = ref<any>(null)
const starRef = ref<any>(null)

function setView(next: ViewName) {
  if (view.value === next) return
  router.replace({ query: { ...route.query, view: next } })
}

const wordCatalog = ref<MarketResource[]>([])
const articleCatalog = ref<MarketResource[]>([])
const loading = ref(true)
const loadError = ref('')
const selectedId = ref('')
const zoom = ref(1)

const tiers = computeTiers(TREE_NODES)
const lanes = computeLanes(TREE_NODES, tiers)

function findBook(list: Dict[], def: TreeNodeDef): Dict | undefined {
  const target = String(def.marketId)
  return list.find(book => String(book.id) === target || String(book.enName ?? '') === target || String(book.sourceId ?? '') === target)
}

// ── 单词星图 ────────────────────────────────────────────────
const starDictId = ref('')
const starStars = ref<Star[]>([])
const starLoading = ref(false)
const starError = ref('')
const selectedWord = ref<Star | null>(null)

const activeStarDict = computed(
  () => wordCatalog.value.find(item => String(item.id) === starDictId.value) ?? wordCatalog.value[0]
)

function meaningOf(word: any): string {
  const first = word?.trans?.[0]
  if (!first?.cn) return ''
  return first.pos ? `${first.pos} ${first.cn}` : first.cn
}

function defaultStarDictId() {
  const current = store.word.bookList[store.word.studyIndex]
  const byCurrent =
    current &&
    wordCatalog.value.find(item => String(item.id) === String(current.id) || item.enName === current.enName)
  return String(byCurrent?.id ?? wordCatalog.value.find(item => String(item.id) === '1')?.id ?? wordCatalog.value[0]?.id ?? '')
}

async function loadStarMap(id?: string) {
  const target = wordCatalog.value.find(item => String(item.id) === String(id ?? starDictId.value)) ?? wordCatalog.value[0]
  if (!target) return
  starDictId.value = String(target.id)
  starLoading.value = true
  starError.value = ''
  try {
    const book = store.word.bookList.find(
      item => String(item.id) === String(target.id) || String(item.enName ?? '') === String(target.id)
    )
    let words: any[]
    if (book?.words?.length) {
      words = book.words
    } else {
      const response = await fetch(resourceWrap(`/dicts/en/word/${target.url}`), {
        cache: 'force-cache',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`${response.status}`)
      words = await response.json()
    }
    const fsrs = store.fsrsData as Record<string, any>
    const known = store.knownWordsSet
    const items = words.map((word: any) => {
      const text = String(word?.word ?? '')
      return { word: text, meaning: meaningOf(word), score: masteryScore(text, fsrs, known) }
    })
    starStars.value = buildStars(items)
    selectedWord.value = null
  } catch (error) {
    starError.value = `词典读取失败：${(error as Error).message}`
    starStars.value = []
  } finally {
    starLoading.value = false
  }
}

const nodes = computed<TreeNodeView[]>(() => {
  const catalog = new Map<string, MarketResource>()
  ;[...wordCatalog.value, ...articleCatalog.value].forEach(item => catalog.set(String(item.id), item))

  const wordBooks = store.word.bookList ?? []
  const articleBooks = store.article.bookList ?? []
  const views = new Map<string, TreeNodeView>()

  // tiers 由最长路径算出，天然是拓扑序，保证依赖节点先算
  const ordered = TREE_NODES.slice().sort((a, b) => (tiers.get(a.id) ?? 0) - (tiers.get(b.id) ?? 0))

  ordered.forEach(def => {
    const resource = catalog.get(def.marketId)
    const book = findBook(def.side === 'word' ? wordBooks : articleBooks, def)
    const length = resource?.length || def.fallbackLength
    const learned = book
      ? Math.max(0, Math.min(book.complete ? length : Number(book.lastLearnIndex) || 0, length))
      : 0
    const progress = length > 0 ? Math.round((learned / length) * 100) : 0

    const missingDeps = def.deps.filter(dep => {
      const parent = views.get(dep)
      return !parent || parent.progress < LIT_THRESHOLD
    })

    let state: TreeNodeState = 'unlocked'
    if (progress >= LIT_THRESHOLD) state = 'lit'
    else if (progress > 0) state = 'active'
    else if (!book && missingDeps.length > 0) state = 'locked'

    views.set(def.id, {
      ...def,
      name: resource?.name || def.fallbackName,
      description: resource?.description || def.tagline,
      length,
      icon: (resource?.icon || def.fallbackName.slice(0, 2)).slice(0, 4),
      accent: resource?.accent || '',
      installed: Boolean(book),
      learned,
      progress,
      state,
      missingDeps,
      tier: tiers.get(def.id) ?? 0,
      lane: lanes.get(def.id) ?? 0,
    })
  })

  return [...views.values()]
})

const nodeMap = computed(() => new Map(nodes.value.map(node => [node.id, node])))
const selected = computed(() => (selectedId.value ? nodeMap.value.get(selectedId.value) : undefined))
const litCount = computed(() => nodes.value.filter(node => node.state === 'lit').length)
const activeCount = computed(() => nodes.value.filter(node => node.state === 'active').length)
const avgProgress = computed(() => {
  if (!nodes.value.length) return 0
  return Math.round(nodes.value.reduce((sum, node) => sum + Math.min(node.progress, 100), 0) / nodes.value.length)
})

const recommended = computed(() => {
  const sorted = nodes.value.slice().sort((a, b) => a.tier - b.tier || a.order - b.order)
  return sorted.find(node => node.state === 'active' && node.progress > 0 && node.progress < LIT_THRESHOLD)
    ?? sorted.find(node => node.state === 'active')
    ?? sorted.find(node => node.state === 'unlocked')
    ?? sorted[0]
})

const selectedDeps = computed(() =>
  (selected.value?.deps ?? []).map(dep => nodeMap.value.get(dep)).filter(Boolean) as TreeNodeView[]
)
const selectedDependents = computed(() =>
  nodes.value.filter(node => node.deps.includes(selected.value?.id ?? ''))
)

const stateLabel: Record<TreeNodeState, string> = {
  lit: '已点亮',
  active: '进行中',
  unlocked: '可开始',
  locked: '未解锁',
}

async function fetchCatalog(url: string): Promise<MarketResource[]> {
  const response = await fetch(resourceWrap(url), { cache: 'no-cache', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`${response.status}`)
  return readMarketCatalog(await response.json())
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [words, articles] = await Promise.all([
      fetchCatalog(DICT_LIST.WORD.ALL),
      fetchCatalog(DICT_LIST.ARTICLE.ALL).catch(() => [] as MarketResource[]),
    ])
    wordCatalog.value = words
    articleCatalog.value = articles
    if (!selectedId.value) selectedId.value = recommended.value?.id ?? ''
    if (!starDictId.value) starDictId.value = defaultStarDictId()
    if (view.value === 'stars') await loadStarMap(starDictId.value)
  } catch (error) {
    loadError.value = `资源目录读取失败：${(error as Error).message}，请检查本地服务后重试。`
  } finally {
    loading.value = false
  }
}

function changeZoom(step: number) {
  zoom.value = Math.min(1.3, Math.max(0.32, Math.round((zoom.value + step) * 100) / 100))
}

const graphRef = ref<any>(null)
const graphWrap = ref<HTMLElement | null>(null)

function exposedWidth(): number {
  const raw = graphRef.value?.width
  const value = typeof raw === 'number' ? raw : Number(raw?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function exposedHeight(): number {
  const raw = graphRef.value?.height
  const value = typeof raw === 'number' ? raw : Number(raw?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

const wrapHeight = ref('')

/** 画布高度跟着缩放走，避免下面留一大块空白 */
function syncWrapHeight() {
  const canvasHeight = exposedHeight()
  if (!canvasHeight || typeof window === 'undefined') return
  const max = Math.round(window.innerHeight * 0.82)
  const next = Math.min(Math.max(320, Math.round(canvasHeight * zoom.value) + 14), max)
  wrapHeight.value = `${next}px`
}

/** 把整张树缩到刚好放进可视宽度；minScale 用来避免节点小到看不清 */
function fitToWidth(minScale = 0.32) {
  const wrap = graphWrap.value
  const canvasWidth = exposedWidth()
  if (!wrap || !canvasWidth) return
  const available = wrap.clientWidth - 24
  if (available <= 0) return
  const ratio = available / canvasWidth
  zoom.value = Math.min(1, Math.max(minScale, Math.round(ratio * 100) / 100))
}

function handleResize() {
  syncWrapHeight()
}

watch([zoom, nodes], async () => {
  await nextTick()
  syncWrapHeight()
})

watch(view, async (next) => {
  await nextTick()
  syncWrapHeight()
  if (next === 'stars' && !starStars.value.length && !starLoading.value) {
    await loadStarMap(starDictId.value || defaultStarDictId())
  }
})

function startStudy(node: TreeNodeView) {
  if (node.side === 'word') {
    router.push({ path: '/dict', query: { from: 'list', id: node.marketId } })
  } else {
    router.push(`/book/${node.marketId}`)
  }
}

function openMarket(node: TreeNodeView) {
  router.push(node.side === 'word' ? '/dict-list' : '/book-list')
}

function openWordInDict() {
  router.push({ path: '/dict', query: { from: 'tree', word: selectedWord.value?.word ?? '' } })
}

onMounted(async () => {
  await load()
  await nextTick()
  syncWrapHeight()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="tt-page">
      <header class="tt-header">
        <div class="tt-header__text">
          <h1>科技树</h1>
          <p>把 14 本词库和 7 本读物接成一张依赖图，先点亮下层，再往上开分支。</p>
        </div>
        <div class="tt-header__stats">
          <div class="tt-chip">
            <b>{{ litCount }}</b>
            <span>/ {{ nodes.length }} 已点亮</span>
          </div>
          <div class="tt-chip">
            <b>{{ avgProgress }}%</b>
            <span>平均完成度</span>
          </div>
          <div class="tt-chip">
            <b>{{ activeCount }}</b>
            <span>进行中</span>
          </div>
        </div>
      </header>

      <div class="tt-toolbar">
        <ul v-if="view === 'metro' || view === 'canvas'" class="tt-legend">
          <li><i class="dot is-lit"></i>已点亮（≥ {{ LIT_THRESHOLD }}%）</li>
          <li><i class="dot is-active"></i>进行中</li>
          <li><i class="dot is-unlocked"></i>可开始</li>
          <li><i class="dot is-locked"></i>前置未点亮</li>
        </ul>
        <span v-else-if="view === 'stars'" class="tt-muted">亮度与颜色只跟掌握度有关：越亮越熟，金色是已掌握</span>
        <ul v-else class="tt-legend">
          <li><i class="dot is-lit"></i>已点亮</li>
          <li><i class="dot is-active"></i>进行中</li>
        </ul>

        <div class="tt-toolbar__right">
          <div class="tt-view-switch" role="tablist" aria-label="视图切换">
            <button
              v-for="item in VIEWS"
              :key="item.id"
              type="button"
              role="tab"
              :aria-selected="view === item.id"
              :class="{ 'is-on': view === item.id }"
              @click="setView(item.id)"
            >
              {{ item.label }}
            </button>
          </div>

          <select
            v-if="view === 'stars'"
            class="tt-select"
            :value="starDictId"
            aria-label="选择词典"
            @change="loadStarMap(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in wordCatalog" :key="item.id" :value="String(item.id)">
              {{ item.name }} · {{ item.length }} 词
            </option>
          </select>

          <div v-if="view === 'graph'" class="tt-zoom">
            <button type="button" aria-label="缩小" @click="changeZoom(-0.1)">−</button>
            <span>{{ Math.round(zoom * 100) }}%</span>
            <button type="button" aria-label="放大" @click="changeZoom(0.1)">＋</button>
            <button type="button" class="tt-zoom__reset" @click="fitToWidth()">适应宽度</button>
            <button type="button" class="tt-zoom__reset" @click="zoom = 1">重置</button>
          </div>
          <template v-else-if="view === 'canvas'">
            <button type="button" class="tt-zoom__reset" @click="canvasRef?.fitAll()">全览</button>
            <button type="button" class="tt-zoom__reset" @click="canvasRef?.relayout()">回到当前</button>
          </template>
        </div>
      </div>

      <div v-if="loading" class="tt-placeholder">正在读取资源目录…</div>
      <div v-else-if="loadError" class="tt-placeholder is-error">
        <p>{{ loadError }}</p>
        <button type="button" @click="load">重试</button>
      </div>

      <div v-else class="tt-layout">
        <div
          ref="graphWrap"
          class="tt-graph-wrap"
          :style="view === 'graph' ? { height: wrapHeight || undefined } : undefined"
        >
          <ClientOnly>
            <TechTreeMetro
              v-if="view === 'metro'"
              :nodes="nodes"
              :selected-id="selectedId"
              class="tt-graph"
              @select="selectedId = $event"
            />
            <TechStarMap
              v-else-if="view === 'stars'"
              ref="starRef"
              :stars="starStars"
              :dict-name="activeStarDict?.name || ''"
              class="tt-graph"
              @select="selectedWord = $event"
            />
            <TechTreeFlow
              v-else-if="view === 'canvas'"
              ref="canvasRef"
              :nodes="nodes"
              :selected-id="selectedId"
              class="tt-graph"
              @select="selectedId = $event"
            />
            <TechTreeGraph
              v-else
              ref="graphRef"
              :nodes="nodes"
              :selected-id="selectedId"
              :zoom="zoom"
              class="tt-graph"
              @select="selectedId = $event"
            />
            <template #fallback>
              <div class="tt-placeholder">视图加载中…</div>
            </template>
          </ClientOnly>
          <span v-if="view === 'graph'" class="tt-graph-hint">Shift + 滚轮或拖动滚动条看完整分支</span>
          <span v-else-if="view === 'canvas'" class="tt-graph-hint">滚轮缩放 · 拖拽平移 · 节点可拖动，「全览」看整张图</span>
        </div>

        <aside class="tt-panel">
          <template v-if="view === 'stars'">
            <template v-if="selectedWord">
              <div class="tt-panel__head">
                <span class="tt-panel__badge">{{ activeStarDict?.name || '词典' }}</span>
                <span class="tt-panel__state" :class="`is-${selectedWord.level === 'mastered' ? 'lit' : 'active'}`">
                  {{ STAR_LEVEL_LABEL[selectedWord.level] }}
                </span>
              </div>
              <h2 class="tt-word">{{ selectedWord.word }}</h2>
              <p class="tt-panel__desc">{{ selectedWord.meaning || '这个词条还没有中文释义。' }}</p>

              <div class="tt-progress">
                <div class="tt-progress__bar"><i :style="{ width: `${Math.round(selectedWord.score * 100)}%` }"></i></div>
                <div class="tt-progress__meta">
                  <span>掌握度</span>
                  <span>{{ Math.round(selectedWord.score * 100) }}%</span>
                </div>
              </div>

              <div class="tt-panel__actions">
                <button type="button" class="tt-btn is-primary" @click="openWordInDict()">去词典页查看</button>
              </div>
            </template>
            <template v-else>
              <h2>点亮一颗星</h2>
              <p class="tt-panel__desc">
                悬停看词，点一下看词条。星越亮代表记得越牢：灰蓝是没学过，青是刚学，紫蓝在复习，金色是已掌握。
              </p>
              <p v-if="starLoading" class="tt-muted">正在铺星…</p>
              <p v-else-if="starError" class="tt-muted">{{ starError }}</p>
            </template>
          </template>

          <template v-else-if="selected">
            <div class="tt-panel__head">
              <span class="tt-panel__badge">{{ selected.side === 'word' ? '词库' : '读物' }}</span>
              <span class="tt-panel__state" :class="`is-${selected.state}`">
                {{ selected.installed && selected.state === 'unlocked' ? '已添加' : stateLabel[selected.state] }}
              </span>
            </div>
            <h2>{{ selected.name }}</h2>
            <p class="tt-panel__desc">{{ selected.description }}</p>

            <div class="tt-progress">
              <div class="tt-progress__bar"><i :style="{ width: `${selected.progress}%` }"></i></div>
              <div class="tt-progress__meta">
                <span>{{ selected.learned }} / {{ selected.length }} {{ selected.side === 'word' ? '词' : '篇' }}</span>
                <span>{{ selected.progress }}%</span>
              </div>
            </div>

            <div class="tt-panel__group">
              <h3>前置</h3>
              <p v-if="!selectedDeps.length" class="tt-muted">无，这是起点节点。</p>
              <ul v-else class="tt-dep-list">
                <li v-for="dep in selectedDeps" :key="dep.id" :class="`is-${dep.state}`">
                  <button type="button" @click="selectedId = dep.id">{{ dep.name }}</button>
                  <span>{{ dep.progress }}%</span>
                </li>
              </ul>
            </div>

            <div v-if="selectedDependents.length" class="tt-panel__group">
              <h3>点亮后解锁</h3>
              <ul class="tt-dep-list">
                <li v-for="child in selectedDependents" :key="child.id" :class="`is-${child.state}`">
                  <button type="button" @click="selectedId = child.id">{{ child.name }}</button>
                  <span>{{ child.progress }}%</span>
                </li>
              </ul>
            </div>

            <div class="tt-panel__actions">
              <button
                v-if="selected.installed"
                type="button"
                class="tt-btn is-primary"
                @click="startStudy(selected)"
              >
                去学习
              </button>
              <button v-else type="button" class="tt-btn is-primary" @click="openMarket(selected)">
                去资源市场添加
              </button>
            </div>
          </template>

          <template v-else>
            <h2>选一个节点</h2>
            <p class="tt-panel__desc">点左侧任意节点查看进度、前置条件和解锁内容。</p>
          </template>

          <div v-if="recommended && view !== 'stars'" class="tt-next">
            <span class="tt-next__label">推荐下一步</span>
            <button type="button" @click="selectedId = recommended.id">{{ recommended.name }}</button>
            <span class="tt-next__meta">{{ stateLabel[recommended.state] }} · {{ recommended.progress }}%</span>
          </div>
        </aside>
      </div>
    </div>
</template>

<style scoped lang="scss">
.tt-page {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: 100%;
  box-sizing: border-box;
  padding: 1.2rem 1.5rem 3rem;
  min-width: 0;
}

.tt-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;

  h1 {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--color-main-text);
  }

  p {
    margin-top: 0.35rem;
    font-size: 0.8rem;
    color: var(--color-sub-text);
    max-width: 46rem;
    line-height: 1.6;
  }
}

.tt-header__stats {
  display: flex;
  gap: 0.5rem;
}

.tt-chip {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.8rem;
  border-radius: 0.65rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
  min-width: 5.4rem;

  b {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-main-text);
  }

  span {
    font-size: 0.68rem;
    color: var(--color-sub-text);
  }
}

.tt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.tt-legend {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.72rem;
  color: var(--color-sub-text);

  li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
}

.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  display: inline-block;

  &.is-lit {
    background: #10b981;
  }

  &.is-active {
    background: var(--color-select-bg);
  }

  &.is-unlocked {
    background: color-mix(in srgb, var(--color-sub-text) 45%, transparent);
  }

  &.is-locked {
    background: transparent;
    border: 1px dashed var(--color-sub-text);
  }
}

.tt-toolbar__right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tt-view-switch {
  display: flex;
  padding: 2px;
  border-radius: 0.55rem;
  border: 1px solid var(--color-line);
  background: var(--color-second);

  button {
    padding: 0.25rem 0.7rem;
    border-radius: 0.42rem;
    font-size: 0.72rem;
    color: var(--color-sub-text);
    cursor: pointer;

    &.is-on {
      background: var(--color-card-bg);
      color: var(--color-main-text);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }
  }
}

.tt-select {
  height: 1.75rem;
  max-width: 13rem;
  padding: 0 0.4rem;
  border-radius: 0.45rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
  color: var(--color-main-text);
  font-size: 0.72rem;
}

.tt-word {
  font-family: var(--word-font-family);
  letter-spacing: 0.01em;
}

.tt-zoom {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-sub-text);

  button {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 0.45rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    line-height: 1;
    cursor: pointer;
  }

  .tt-zoom__reset {
    width: auto;
    padding: 0 0.55rem;
    font-size: 0.7rem;
  }

  span {
    min-width: 2.6rem;
    text-align: center;
  }
}

.tt-placeholder {
  padding: 3rem 1rem;
  text-align: center;
  color: var(--color-sub-text);
  font-size: 0.82rem;
  border: 1px dashed var(--color-line);
  border-radius: 0.9rem;

  &.is-error {
    color: #ef4444;
  }

  button {
    margin-top: 0.75rem;
    padding: 0.35rem 0.9rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    cursor: pointer;
  }
}

.tt-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 19rem;
  gap: 0.9rem;
  align-items: start;
}

.tt-graph-wrap {
  position: relative;
  height: calc(100dvh - 15.5rem);
  min-height: 24rem;
}

.tt-graph-hint {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0.5rem;
  font-size: 0.66rem;
  color: var(--color-sub-text);
  background: color-mix(in srgb, var(--color-second) 88%, transparent);
  padding: 0.15rem 0.45rem;
  border-radius: 0.35rem;
  pointer-events: none;
  opacity: 0.85;
  white-space: nowrap;
}

.tt-graph {
  height: 100%;
}

.tt-panel {
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  padding: 0.9rem;
  position: sticky;
  top: 1rem;

  h2 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-main-text);
    line-height: 1.35;
    margin-top: 0.45rem;
  }

  h3 {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--color-sub-text);
    margin-bottom: 0.35rem;
  }
}

.tt-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.tt-panel__badge {
  font-size: 0.66rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.3rem;
  background: var(--color-third);
  color: var(--color-sub-text);
}

.tt-panel__state {
  font-size: 0.68rem;
  font-weight: 600;

  &.is-lit {
    color: #10b981;
  }

  &.is-active {
    color: var(--color-select-bg);
  }

  &.is-unlocked {
    color: var(--color-sub-text);
  }

  &.is-locked {
    color: var(--color-sub-text);
    opacity: 0.75;
  }
}

.tt-panel__desc {
  margin-top: 0.45rem;
  font-size: 0.75rem;
  line-height: 1.65;
  color: var(--color-sub-text);
}

.tt-progress {
  margin-top: 0.8rem;
}

.tt-progress__bar {
  height: 6px;
  border-radius: 999px;
  background: var(--color-third);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #10b981, #0ea5e9);
    transition: width 0.3s ease;
  }
}

.tt-progress__meta {
  display: flex;
  justify-content: space-between;
  margin-top: 0.3rem;
  font-size: 0.68rem;
  color: var(--color-sub-text);
}

.tt-panel__group {
  margin-top: 0.9rem;
}

.tt-dep-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
    padding: 0.28rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--color-second);
    color: var(--color-main-text);

    span {
      color: var(--color-sub-text);
      font-size: 0.68rem;
    }

    &.is-lit {
      background: rgba(16, 185, 129, 0.1);
    }

    &.is-locked {
      opacity: 0.7;
    }
  }

  button {
    text-align: left;
    cursor: pointer;
    color: inherit;
  }
}

.tt-muted {
  font-size: 0.72rem;
  color: var(--color-sub-text);
}

.tt-panel__actions {
  margin-top: 1rem;
}

.tt-btn {
  width: 100%;
  padding: 0.5rem;
  border-radius: 0.55rem;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-line);
  background: var(--color-second);
  color: var(--color-main-text);

  &.is-primary {
    background: var(--color-select-bg);
    border-color: transparent;
    color: #fff;
  }
}

.tt-next {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px dashed var(--color-line);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;

  button {
    text-align: left;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-select-bg);
    cursor: pointer;
  }
}

.tt-next__label {
  font-size: 0.68rem;
  color: var(--color-sub-text);
}

.tt-next__meta {
  font-size: 0.68rem;
  color: var(--color-sub-text);
}

@media (max-width: 1100px) {
  .tt-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .tt-graph-wrap {
    height: 60vh;
  }

  .tt-panel {
    position: static;
  }
}
</style>
