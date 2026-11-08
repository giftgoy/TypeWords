<script setup lang="ts">
import ArticleDictionaryAnalysis from './ArticleDictionaryAnalysis.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Article, Sentence } from '@/core/types/types.ts'
import { PracticeArticleWordType } from '@/core/types/enum.ts'
import { loadGlossBundle, createGlossBundle, wordsToEntries, annoGloss, tableGloss, type GlossBundle } from '@/core/immersive/gloss.ts'
import { annotationLanes } from '@/core/immersive/annotations.ts'
import { useReadingVocabulary } from '@/core/immersive/vocabulary.ts'
import { useReaderAudio } from '@/core/immersive/useReaderAudio.ts'
import { phraseTokenIndexes } from '@/core/immersive/phrases.ts'
import { readingRequest } from '@/core/immersive/api.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { SyncDataType } from '@/core/types/enum'
import { excludeSimpleAnnotations } from '@/core/immersive/simple-annotations.ts'
import { getDefaultWord } from '@/core/types/func.ts'
import { usePlayWordAudio } from '@/core/hooks/sound.ts'
import { lookupWord } from '@/core/hooks/useWordLookup.ts'
import { get, set, flushStorage, storageStatus, reloadSharedStorage, retrySharedStorage } from '@/core/utils/storage'
import AiModelStatus from './AiModelStatus.vue'
import md5 from 'md5'
import { lemmaCandidates } from '@/core/immersive/lemmatize.ts'

/**
 * 沉浸式阅读视图
 *
 * - 段落级中英对照：英文段落下方紧跟对应中文段落
 * - 所选词库或文章目标词：黄色底部高亮 + 加粗蓝字
 * - 重点搭配：绿色点状下划线
 * - 内联注音：目标词正下方 11px 中文释义
 * - 页底：值得背诵的搭配（点击滚动 + 绿色闪烁）/ 单词对照表
 *
 * 词典覆盖全部随附英语词库及自建词库；语境释义来自文章教材数据或阅读模型服务。
 */
const props = withDefaults(
  defineProps<{
    article: Article
    showTranslate?: boolean
  }>(),
  { showTranslate: true }
)

interface RenderedToken {
  text: string
  space: boolean
  kind: 'word' | 'symbol'
  /** 命中的词库原形 */
  lemma?: string
  /** 词下注音 */
  gloss?: string
  /** 完整释义，单词对照表用 */
  fullGloss?: string
  phonetic?: string
  /** 命中的搭配（英文原样） */
  phrase?: string
  phraseCn?: string
  /** 该 token 后面的空格是否属于搭配内部（用于把点状下划线连起来） */
  phraseSpace?: boolean
  /** 原生 title，hover 时先给一个轻量释义 */
  title?: string
  target?: boolean
  form?: string
  annotationExcluded?: boolean
}

interface RenderedParagraph {
  tokens: RenderedToken[]
  cn: string
}

const bundle = ref<GlossBundle | null>(null)
const status = ref<'loading' | 'ready' | 'failed'>('loading')
const glossVisible = ref(true)
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const annotationSaving = ref(false)
const annotationSaveError = ref('')
async function saveAnnotationPreference() {
  annotationSaving.value = true
  annotationSaveError.value = ''
  try {
    await persistence.saveLocalAndSync(SyncDataType.setting, settings.$state, { pullWhenRemoteNewer: false })
    await flushStorage()
    if (storageStatus.phase === 'conflict' || storageStatus.phase === 'offline') annotationSaveError.value = storageStatus.message
  } catch {
    annotationSaveError.value = '标注设置暂未保存，请稍后重新切换重试。'
  } finally {
    annotationSaving.value = false
  }
}
const { sources, load } = useReadingVocabulary()
const source = ref('')
const targetLemmas = ref<Set<string> | null>(null)
const player = useReaderAudio(() => props.article)
const { state: audioState, currentParagraph, rate, error: audioError, notice: audioNotice } = player
const autoScroll = ref(true)
const playWord = usePlayWordAudio()
const study = ref(props.article.readingStudy)
const analyzing = ref(false)
const analysisError = ref('')
let baseBundle: GlossBundle | null = null
let sourceRequest = 0
let analysisRequest = 0
const cacheKey = () => `reading-study:${md5(props.article.text)}`

async function changeSource() {
  analysisRequest++
  analyzing.value = false
  const ticket = ++sourceRequest
  status.value = 'loading'
  try {
    const words = source.value ? await load(source.value) : []
    if (ticket !== sourceRequest) return
    targetLemmas.value = source.value ? new Set(words.map(w => w.word.toLowerCase())) : null
    const entries = { ...baseBundle?.words, ...wordsToEntries(words) }
    bundle.value = createGlossBundle({ v: 1, count: Object.keys(entries).length, words: entries })
    status.value = 'ready'
  } catch (error) { if (ticket === sourceRequest) { status.value = 'failed'; analysisError.value = (error as Error).message } }
}

async function lookup(event: MouseEvent, token: RenderedToken) {
  player.pause()
  const localWord = token.lemma ? getDefaultWord({ word: token.lemma, phonetic1: token.phonetic || '', trans: [{ pos: '', cn: token.fullGloss || '' }] }) : undefined
  await lookupWord(event, token.text, playWord, localWord)
}

async function calibrate() {
  const ticket = ++analysisRequest
  const key = cacheKey()
  analyzing.value = true
  analysisError.value = ''
  try {
    const targets = [...new Set(glossary.value.map(v => v.lemma))]
    const vocabulary = []
    const phrases = new Map()
    let theme = ''
    for (let i = 0; i < targets.length; i += 100) {
      const result = await readingRequest('analyze', {
        words: targets.slice(i, i + 100).join(','),
        paragraphs: props.article.sections.map(s => s.map(v => v.text).join(' ')),
        session: key,
      })
      if (ticket !== analysisRequest) return
      vocabulary.push(...result.vocabulary)
      result.phrases.forEach(p => phrases.set(`${p.paragraph}:${p.text}`, p))
      theme = result.theme
    }
    if (!targets.length) throw new Error('当前没有可校准的目标词，请先选择词库。')
    const calibrated = { targets, vocabulary, phrases: [...phrases.values()], theme }
    study.value = calibrated
    await set(key, calibrated)
  } catch (error) { if (ticket === analysisRequest) analysisError.value = (error as Error).message }
  finally { if (ticket === analysisRequest) analyzing.value = false }
}

async function loadStudy() {
  const key = cacheKey()
  const saved = props.article.readingStudy || await get(key)
  if (key === cacheKey()) study.value = saved
}

watch(() => props.article.id, () => {
  analysisRequest++
  analyzing.value = false
  study.value = props.article.readingStudy
  void loadStudy()
})
watch(currentParagraph, index => {
  if (index !== null && autoScroll.value) blockEls.value[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

const blockEls = ref<HTMLElement[]>([])
const flashIndex = ref<number | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

const rootRef = ref<HTMLElement | null>(null)
/** 相邻目标词的注音压在一起时，第二个注音下移这么多像素 */
const ROW_SHIFT = 12

/**
 * 注音是绝对定位的，不占排版空间，所以相邻目标词的注音会互相压住。
 * 这里在渲染后量一次真实位置：与同一行上一个注音重叠的就整体下移一行。
 */
function layoutAnnotations() {
  const root = rootRef.value
  if (!root) return
  for (const paragraph of root.querySelectorAll<HTMLElement>('.imm-en')) {
    paragraph.style.lineHeight = ''
    paragraph.style.paddingBottom = ''
    const nodes = Array.from(paragraph.querySelectorAll<HTMLElement>('.imm-anno'))
    for (const node of nodes) node.style.transform = ''
    const rects = nodes.map(node => node.getBoundingClientRect())
    const lanes = annotationLanes(rects)
    nodes.forEach((node, i) => {
      node.style.transform = `translateX(-50%) translateY(${lanes[i] * ROW_SHIFT}px)`
    })
    if (nodes.length) {
      const baseHeight = parseFloat(getComputedStyle(paragraph).lineHeight)
      const wordHeight = nodes[0].parentElement!.getBoundingClientRect().height
      const neededHeight = wordHeight + 3 + rects[0].height + Math.max(...lanes) * ROW_SHIFT + 6
      const lineHeight = Math.max(baseHeight, neededHeight)
      paragraph.style.lineHeight = `${lineHeight}px`
      paragraph.style.paddingBottom = `${Math.max(0, neededHeight - 6 - (lineHeight + wordHeight) / 2)}px`
    }
  }
}

let resizeObserver: ResizeObserver | null = null
let observedWidth = 0

onMounted(async () => {
  baseBundle = await loadGlossBundle()
  const custom = store.word.bookList.flatMap(book => book.words)
  const entries = { ...baseBundle?.words, ...wordsToEntries(custom) }
  bundle.value = createGlossBundle({ v: 1, count: Object.keys(entries).length, words: entries })
  await loadStudy()
  status.value = bundle.value ? 'ready' : 'failed'
  await nextTick()
  await document.fonts.ready
  layoutAnnotations()
  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === observedWidth) return
      observedWidth = entry.contentRect.width
      layoutAnnotations()
    })
    resizeObserver.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  analysisRequest++
  sourceRequest++
  if (flashTimer) clearTimeout(flashTimer)
  resizeObserver?.disconnect()
  resizeObserver = null
})

function annotateSentence(sentence: Sentence, b: GlossBundle | null, paragraphIndex: number): RenderedToken[] {
  const tokens: RenderedToken[] = (sentence.words ?? []).map(word => ({
    text: word.word,
    space: !!word.nextSpace,
    kind: word.type === PracticeArticleWordType.Word ? 'word' : 'symbol',
  }))

  if (!b) return tokens

  for (const token of tokens) {
    if (token.kind !== 'word') continue
    let hit = b.find(token.text)
    if (targetLemmas.value && (!hit || !targetLemmas.value.has(hit.lemma))) {
      const lemma = lemmaCandidates(token.text).find(w => targetLemmas.value!.has(w))
      if (lemma && b.words[lemma]) hit = { lemma, entry: b.words[lemma] }
    }
    if (!hit) continue
    token.lemma = hit.lemma
    token.target = targetLemmas.value ? targetLemmas.value.has(token.lemma) : study.value?.targets?.length ? study.value.targets.includes(token.lemma) : true
    token.gloss = annoGloss(hit.entry.t)
    token.fullGloss = tableGloss(hit.entry.t)
    token.phonetic = hit.entry.p || ''
    token.title = [token.phonetic ? `/${token.phonetic}/` : '', token.fullGloss, '词典释义，尚未语境校准'].filter(Boolean).join(' ')
  }

  for (const context of study.value?.vocabulary.filter(v => v.paragraph === paragraphIndex) || []) {
    const matches = phraseTokenIndexes(tokens, context.form, true)
    for (const indexes of context.occurrence === undefined ? matches : [matches[context.occurrence]].filter(Boolean)) {
      for (const index of indexes) Object.assign(tokens[index], {
        lemma: context.lemma, form: context.form,
        gloss: index === indexes[0] ? annoGloss(context.meaning) : undefined, fullGloss: context.meaning, phonetic: context.phonetic?.replace(/^\/|\/$/g, '') || '',
        target: targetLemmas.value ? targetLemmas.value.has(context.lemma) || targetLemmas.value.has(context.form.toLowerCase()) : study.value.targets.includes(context.lemma) || study.value.targets.includes(context.form.toLowerCase()),
        title: `${context.meaning}（文中释义）`,
      })
    }
  }

  const firstLemmas = new Set(tokens.filter(t => t.kind === 'word').flatMap(t => b.find(t.text)?.lemma || t.text.toLowerCase()))
  const candidates = [...firstLemmas].flatMap(first => b.phraseStarts.get(first) || [])
  for (const phrase of [...candidates.map(p => ({ text: p.phrase, meaning: p.cn })), ...(study.value?.phrases.filter(p => p.paragraph === paragraphIndex) || [])]) {
    for (const indexes of phraseTokenIndexes(tokens, phrase.text)) {
      for (const k of indexes) {
        tokens[k].phrase = phrase.text
        tokens[k].phraseCn = phrase.meaning
        tokens[k].phraseSpace = k < indexes[indexes.length - 1]
        const lemma = phrase.text.toLowerCase()
        const entry = b.words[lemma]
        if (entry && lemma.includes(' ') && !tokens[k].form) Object.assign(tokens[k], {
          lemma, form: indexes.map(i => tokens[i].text).join(' '),
          target: targetLemmas.value ? targetLemmas.value.has(lemma) : !study.value?.targets.length || study.value.targets.includes(lemma),
          gloss: annoGloss(entry.t), fullGloss: tableGloss(entry.t), phonetic: entry.p || '',
        })
      }
    }
  }

  return excludeSimpleAnnotations(tokens, store.allIgnoreWordsSet, settings.readingHideSimpleAnnotations)
}

const paragraphs = computed<RenderedParagraph[]>(() => {
  const sections = props.article?.sections ?? []
  return sections.map((section, i) => ({
    tokens: annotateSentence({ ...section[0], words: section.flatMap(sentence => sentence.words) }, bundle.value, i),
    cn: section
      .map(sentence => sentence.translate)
      .filter(Boolean)
      .join(''),
  }))
})
const hiddenAnnotationCount = computed(() => new Set(paragraphs.value.flatMap(p => p.tokens)
  .filter(t => t.annotationExcluded).map(t => t.text.toLowerCase().replace(/[’‘]/g, "'"))).size)

/** 单词对照表：按正文出现顺序聚合，保留文中变形 */
const glossary = computed(() => {
  const order: string[] = []
  const rows = new Map<string, { lemma: string; phonetic: string; gloss: string; forms: string[] }>()

  for (const paragraph of paragraphs.value) {
    for (const token of paragraph.tokens) {
      if (!token.lemma || !token.target) continue
      const key = `${token.lemma}:${token.fullGloss}`
      let row = rows.get(key)
      if (!row) {
        row = {
          lemma: token.lemma,
          phonetic: token.phonetic ?? '',
          gloss: token.fullGloss ?? '',
          forms: [],
        }
        rows.set(key, row)
        order.push(key)
      }
      const form = token.form || token.text
      if (form && !row.forms.includes(form)) row.forms.push(form)
    }
  }

  return order.map(lemma => rows.get(lemma)!)
})

// 段落（含注音）或注音开关变化后重新排版，注意要放在 paragraphs 定义之后
watch([paragraphs, glossVisible], () => nextTick(layoutAnnotations))

/** 页底「值得背诵的搭配」：去重并记录首次出现的段落 */
const phraseList = computed(() => {
  const found = new Map<string, { phrase: string; cn: string; paragraphIndex: number }>()
  paragraphs.value.forEach((paragraph, paragraphIndex) => {
    for (const token of paragraph.tokens) {
      if (!token.phrase || found.has(token.phrase)) continue
      found.set(token.phrase, { phrase: token.phrase, cn: token.phraseCn ?? '', paragraphIndex })
    }
  })
  return [...found.values()]
})

function setBlockEl(el: any, index: number) {
  if (el) blockEls.value[index] = el as HTMLElement
}

async function jumpToParagraph(index: number) {
  const el = blockEls.value[index]
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  flashIndex.value = null
  await nextTick()
  // Restart the animation even when the same phrase is selected again.
  void el.offsetWidth
  flashIndex.value = index
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashIndex.value = null), 1500)
}
</script>

<template>
  <div class="imm-article" ref="rootRef">
    <div class="imm-player" aria-label="正文播放">
      <button type="button" @click="player.play()">全文播放</button>
      <button v-if="audioState === 'playing' || audioState === 'loading'" type="button" @click="player.pause()">暂停</button>
      <button v-else-if="audioState === 'paused'" type="button" @click="player.resume()">继续播放</button>
      <button type="button" :disabled="audioState === 'idle'" @click="player.stop()">停止</button>
      <label>语速 <select v-model.number="rate" aria-label="朗读语速"><option v-for="speed in [0.5, 0.75, 1, 1.25, 1.5, 2]" :value="speed">{{ speed }}×</option></select></label>
      <label><input type="checkbox" v-model="autoScroll" />跟随朗读</label>
      <span role="status">{{ audioState === 'loading' ? '正在准备音频…' : currentParagraph !== null ? `第 ${currentParagraph + 1} 段` : '' }}</span>
    </div>
    <p v-if="audioError" class="imm-message" role="alert">{{ audioError }}</p>
    <p v-if="audioNotice" class="imm-message" role="status">{{ audioNotice }}</p>
    <div class="imm-study-tools">
      <label>目标词库 <select v-model="source" @change="changeSource"><option value="">{{ study?.targets?.length ? '本文目标词' : '全部英语词库' }}</option><option v-for="item in sources" :value="item.key" :key="item.key">{{ item.name }}</option></select></label>
      <label title="按简单词和已掌握列表隐藏释义、高亮与下划线，仍可点击查词"><input type="checkbox" v-model="settings.readingHideSimpleAnnotations" :disabled="!settings.load || annotationSaving" @change="saveAnnotationPreference" />隐藏简单词标注</label>
      <NuxtLink to="/setting?index=0">管理简单词</NuxtLink>
      <button type="button" :disabled="analyzing || status !== 'ready'" @click="calibrate">{{ analyzing ? '正在结合语境校准…' : '校准语境释义与搭配' }}</button>
      <NuxtLink to="/reading-studio">用目标词写短文</NuxtLink>
    </div>
    <p v-if="annotationSaveError" class="imm-message" role="status">{{ annotationSaveError }} <button v-if="storageStatus.phase === 'conflict'" type="button" @click="reloadSharedStorage">备份当前副本并载入服务器记录</button><button v-else type="button" @click="retrySharedStorage">重试保存</button></p>
    <AiModelStatus />
    <ArticleDictionaryAnalysis :text="article.text" />
    <p v-if="analysisError" class="imm-message" role="alert">{{ analysisError }}</p>
    <div class="imm-head">
      <span class="imm-stat" v-if="status === 'ready'">
        目标词 {{ new Set(glossary.map(v => v.lemma)).size }} 个<span v-if="phraseList.length"> · 搭配 {{ phraseList.length }} 条</span> · {{ study ? '含文中释义；未校准词使用词典' : '词典释义（尚未语境校准）' }}
        <span v-if="settings.readingHideSimpleAnnotations && hiddenAnnotationCount"> · 已隐藏 {{ hiddenAnnotationCount }} 种简单／已掌握词形标注</span>
      </span>
      <span class="imm-stat" v-else-if="status === 'loading'">正在加载词库…</span>
      <span class="imm-stat imm-stat--warn" v-else>释义索引加载失败，仅显示原文。</span>
      <button type="button" class="imm-toggle" :aria-pressed="glossVisible" :disabled="status !== 'ready'" @click="glossVisible = !glossVisible">
        {{ glossVisible ? '隐藏注音' : '显示注音' }}
      </button>
    </div>

    <section
      class="imm-block"
      :class="{ 'imm-flash': flashIndex === i, 'imm-reading': currentParagraph === i }"
      v-for="(paragraph, i) in paragraphs"
      :key="i"
      :ref="el => setBlockEl(el, i)"
    >
      <button type="button" class="imm-paragraph-play" :aria-label="`播放第 ${i + 1} 段`" @click="player.play(i)"><IconFluentPlay20Regular /></button>
      <span class="imm-en" :class="{ 'no-anno': !glossVisible }">
        <template v-for="(token, k) in paragraph.tokens" :key="k">
          <span
            class="imm-word"
            :class="{ 'is-target': token.target, 'is-phrase': !!token.phrase, 'is-clickable': token.kind === 'word' }"
            :title="token.title"
            :role="token.kind === 'word' ? 'button' : undefined"
            :tabindex="token.kind === 'word' ? 0 : undefined"
            @click="token.kind === 'word' && lookup($event, token)"
            @keydown.enter.prevent="token.kind === 'word' && lookup($event, token)"
            @keydown.space.prevent="token.kind === 'word' && lookup($event, token)"
          >
            <span class="imm-word-text">{{ token.text }}</span>
            <span v-if="glossVisible && token.target && token.gloss" class="imm-anno">{{ token.gloss }}</span>
          </span>
          <span
            v-if="token.space"
            class="imm-space"
            :class="{ 'is-phrase-space': !!token.phraseSpace }"
          >{{ ' ' }}</span>
        </template>
      </span>
      <span v-if="showTranslate && paragraph.cn" class="imm-cn">{{ paragraph.cn }}</span>
    </section>
    <p v-if="study?.theme" class="imm-message">{{ study.theme }}</p>

    <div class="imm-panels" v-if="status === 'ready' && (glossary.length || phraseList.length)">
      <section class="imm-panel" v-if="phraseList.length">
        <h3 class="imm-panel-title">值得背诵的搭配 / 句型</h3>
        <ul class="imm-phrases">
          <li v-for="item in phraseList" :key="item.phrase">
            <button type="button" class="imm-phrase" @click="jumpToParagraph(item.paragraphIndex)">
              <span class="imm-phrase-en">{{ item.phrase }}</span>
              <span class="imm-phrase-cn">{{ item.cn }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section class="imm-panel" v-if="glossary.length">
        <h3 class="imm-panel-title">单词对照表</h3>
        <table class="imm-table">
          <thead>
            <tr>
              <th>原词</th>
              <th>音标</th>
              <th>文中形式</th>
              <th>释义</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in glossary" :key="`${row.lemma}:${row.gloss}`">
              <td class="imm-table-word">{{ row.lemma }}</td>
              <td class="imm-table-phonetic">{{ row.phonetic ? `/${row.phonetic}/` : '' }}</td>
              <td class="imm-table-forms">{{ row.forms.join(' / ') }}</td>
              <td class="imm-table-gloss">{{ row.gloss }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.imm-article {
  font-size: 1.12rem;
  color: var(--color-article);
}

.imm-player, .imm-study-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font: 13px/1.5 var(--font-family);
  margin-bottom: 12px;
}
.imm-player button, .imm-study-tools button, .imm-player select, .imm-study-tools select {
  background: var(--color-second);
  color: var(--color-main-text);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  max-width: 100%;
}
.imm-study-tools label { min-width: 0; max-width: 100%; }
.imm-study-tools label:has(input[type=checkbox]) { display: inline-flex; align-items: center; gap: 5px; }
.imm-study-tools select { max-width: 240px; }
.imm-player button:disabled { opacity: .45; cursor: default; }
.imm-player label { display: inline-flex; align-items: center; gap: 4px; }
.imm-message { font: 13px/1.7 var(--font-family); color: var(--color-main-text); margin-block: 8px 16px; }
.imm-reading { background: rgba(37, 99, 235, .08); }
.imm-paragraph-play {
  float: right;
  display: inline-flex;
  padding: 6px;
  color: var(--color-link);
  cursor: pointer;
  background: var(--color-second);
  border-radius: 4px;
}
.is-clickable { cursor: pointer; }
.is-clickable:hover { color: var(--color-link); }
.is-clickable:focus-visible { outline: 2px solid var(--color-link); outline-offset: 2px; }

.imm-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  font-family: var(--font-family);
}

.imm-stat {
  font-size: 0.78rem;
  color: var(--color-main-text);
  letter-spacing: 0.02em;

  &--warn {
    color: #d97706;
  }
}

.imm-toggle {
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: transparent;
  color: var(--color-font-3);
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 0.3rem;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    color: var(--color-article);
    border-color: var(--color-article);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.imm-block {
  margin: 0 0 1.4rem;
  padding-bottom: 1rem;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.28);
  border-radius: 0.4rem;

  &:last-of-type {
    border-bottom: 0;
  }
}

.imm-en {
  display: block;
  font-family: var(--en-article-family);
  /* 注音挂在词下，行高要留出「一行注音 + 一行错位注音」的空间 */
  line-height: 2.85;
  text-indent: 2em;
  color: var(--color-article);

  /* 关掉注音后没有挂件了，行距收回正常阅读密度 */
  &.no-anno {
    line-height: 2;
  }
}

.imm-cn {
  display: block;
  margin-top: 0.4rem;
  font-family: var(--zh-article-family);
  font-size: 0.94em;
  line-height: 1.95;
  text-indent: 2em;
  color: var(--color-font-3);
}

.imm-word {
  position: relative;
  display: inline-block;
  vertical-align: baseline;
  line-height: 1.35;
  /* inline-block 也是块容器，会继承父级的 text-indent，必须清零，否则每个词前面多出一个缩进 */
  text-indent: 0;
}

.imm-word-text {
  padding: 0 1px;
  border-radius: 2px;
}

/* 目标词：黄色底部高亮 + 加粗蓝字 */
.imm-word.is-target > .imm-word-text {
  background: linear-gradient(180deg, transparent 58%, rgba(250, 204, 21, 0.55) 58%);
  color: #1d4ed8;
  font-weight: 700;
}

/* 重点搭配：绿色点状下划线（挂在词盒底部，不影响行高） */
.imm-word.is-phrase {
  border-bottom: 2px dotted rgba(22, 163, 74, 0.85);
  padding-bottom: 1px;
}

/*
 * 注解用绝对定位挂在单词下方：
 * 不参与行内排版 → 不会把单词挤成整块、不会造成提前换行或横向溢出。
 */
.imm-word > .imm-anno {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  margin-top: 3px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--zh-article-family);
  font-size: 11px;
  line-height: 12px;
  color: #6b7280;
  letter-spacing: 0;
  white-space: nowrap;
  font-weight: 400;
  pointer-events: none;
}

:global(html.dark) .imm-word.is-target > .imm-word-text {
  background: linear-gradient(180deg, transparent 58%, rgba(250, 204, 21, 0.32) 58%);
  color: #93c5fd;
}

:global(html.dark) .imm-word > .imm-anno {
  color: rgba(255, 255, 255, 0.7);
}

.imm-space {
  white-space: pre;
  /* 同 .imm-word：inline-block 会继承 text-indent，必须清零 */
  text-indent: 0;
}

/* 搭配内部的空格也画上点状下划线，让整条搭配连成一条线 */
.imm-space.is-phrase-space {
  display: inline-block;
  vertical-align: baseline;
  line-height: 1.35;
  border-bottom: 2px dotted rgba(22, 163, 74, 0.85);
  padding-bottom: 1px;
}

/* 点击搭配后，对应段落绿色闪烁 */
.imm-flash {
  animation: immFlash 1.5s ease;
}

@keyframes immFlash {
  0%,
  100% {
    background: transparent;
  }
  25%,
  70% {
    background: rgba(34, 197, 94, 0.16);
  }
}

.imm-panels {
  margin-top: 2.4rem;
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  font-family: var(--font-family);
}

.imm-panel {
  border-top: 1px dashed rgba(148, 163, 184, 0.32);
  padding-top: 1rem;
}

.imm-panel-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-article);
  margin: 0 0 0.6rem;
}

.imm-phrases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
}

.imm-phrase {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(22, 163, 74, 0.35);
  border-radius: 0.3rem;
  background: rgba(22, 163, 74, 0.06);
  cursor: pointer;
  transition: all 0.2s;
  font-family: var(--font-family);
  max-width: 100%;
  flex-wrap: wrap;
  text-align: left;

  &:hover {
    background: rgba(22, 163, 74, 0.14);
    border-color: rgba(22, 163, 74, 0.6);
  }
}

.imm-phrase-en {
  font-size: 0.86rem;
  font-weight: 600;
  color: #15803d;
}

.imm-phrase-cn {
  font-size: 0.74rem;
  color: var(--color-font-3);
}

.imm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;

  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    vertical-align: top;
  }

  th {
    font-weight: 600;
    color: var(--color-font-3);
    font-size: 0.74rem;
    white-space: nowrap;
  }

  td {
    color: var(--color-article);
  }
}

.imm-table-word {
  font-weight: 600;
  color: #1d4ed8;
  white-space: nowrap;
}

.imm-table-phonetic {
  color: var(--color-font-3);
  white-space: nowrap;
  font-size: 0.74rem;
}

.imm-table-forms {
  color: var(--color-font-3);
  white-space: nowrap;
}

.imm-table-gloss {
  line-height: 1.5;
}

/* 窄屏：字号减小、表格压缩 */
@media (max-width: 768px) {
  .imm-article {
    font-size: 0.98rem;
  }

  .imm-en {
    line-height: 2.4;
    text-indent: 2em;

    &.no-anno {
      line-height: 1.9;
    }
  }

  .imm-cn {
    line-height: 1.8;
  }

  .imm-word > .imm-anno {
    font-size: 10px;
    max-width: 96px;
  }

  .imm-table {
    font-size: 0.72rem;
    table-layout: fixed;

    th,
    td {
      padding: 0.3rem 0.25rem;
    }

    /* 窄屏放不下四列，音标列直接收起来 */
    th:nth-child(2) {
      display: none;
    }
  }

  .imm-table-phonetic {
    display: none;
  }

  .imm-table-word,
  .imm-table-forms,
  .imm-table-gloss {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
