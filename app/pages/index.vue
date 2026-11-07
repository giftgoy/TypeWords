<script setup lang="ts">
import GrowthOverview from '@/components/growth/GrowthOverview.vue'
import { APP_NAME, GITHUB, DICT_LIST } from '@/core/config/env.ts'
import { resourceWrap } from '@/core/utils'
import { readMarketCatalog } from '@/core/utils/resource-market'
import { usePlayBeep, usePlayCorrect, usePlayKeyboardAudio } from '@/core/hooks/sound.ts'

definePageMeta({ layout: 'empty' })
const { t } = useI18n()
const dictionaryCount = ref<number | null>(null)
let mobileMenuOpen = $ref(false)
onMounted(async () => {
  try {
    const response = await fetch(resourceWrap(DICT_LIST.WORD.ALL))
    if (response.ok) dictionaryCount.value = readMarketCatalog(await response.json()).length
  } catch {}
})

const demoWords = $computed(() => [
  {
    word: 'persevere',
    phonetic: '/ˌpɜːrsɪˈvɪər/',
    trans: t('demo_word_persevere_trans'),
    examples: [
      { en: 'You must persevere if you want to succeed.', zh: t('demo_word_persevere_ex1') },
      { en: 'She persevered through years of hardship.', zh: t('demo_word_persevere_ex2') },
    ],
  },
  {
    word: 'eloquent',
    phonetic: '/ˈeləkwənt/',
    trans: t('demo_word_eloquent_trans'),
    examples: [
      { en: 'He gave an eloquent speech at the ceremony.', zh: t('demo_word_eloquent_ex1') },
      { en: 'Her eloquent writing moved the audience deeply.', zh: t('demo_word_eloquent_ex2') },
    ],
  },
  {
    word: 'diligent',
    phonetic: '/ˈdɪlɪdʒənt/',
    trans: t('demo_word_diligent_trans'),
    examples: [
      { en: 'A diligent student always finishes homework on time.', zh: t('demo_word_diligent_ex1') },
      { en: 'He was diligent in his research and rarely took breaks.', zh: t('demo_word_diligent_ex2') },
    ],
  },
  {
    word: 'profound',
    phonetic: '/prəˈfaʊnd/',
    trans: t('demo_word_profound_trans'),
    examples: [
      { en: 'Reading widely has a profound effect on vocabulary.', zh: t('demo_word_profound_ex1') },
      { en: 'The discovery had a profound impact on modern science.', zh: t('demo_word_profound_ex2') },
    ],
  },
])
let demoIdx = $ref(0)
let demoInput = $ref('')
let demoWrong = $ref('')
let demoDone = $ref(false)
let demoShake = $ref(false)

const demoWord = $computed(() => demoWords[demoIdx])
const demoRemain = $computed(() => demoWord.word.slice(demoInput.length + demoWrong.length))

function demoNextWord() {
  demoDone = false
  demoInput = ''
  demoWrong = ''
  demoIdx = (demoIdx + 1) % demoWords.length
}

function onDemoKey(e: KeyboardEvent) {
  if (demoDone) {
    if (e.code === 'Space') {
      e.preventDefault()
      demoNextWord()
    }
    return
  }
  if (e.key.length !== 1) return
  e.preventDefault()
  const target = demoWord.word
  const pos = demoInput.length
  if (demoWrong) return
  if (e.key.toLowerCase() === target[pos].toLowerCase()) {
    demoInput += e.key
    demoWrong = ''
    playDemoKeyboard()
    if (demoInput.length === target.length) {
      demoDone = true
      playDemoCorrect()
    }
  } else {
    demoWrong = e.key
    demoShake = true
    playDemoBeep()
    setTimeout(() => {
      demoWrong = ''
      demoShake = false
    }, 500)
  }
}

function onDemoBackspace(e: KeyboardEvent) {
  if (e.code === 'Backspace') {
    e.preventDefault()
    if (demoWrong) {
      demoWrong = ''
      return
    }
    demoInput = demoInput.slice(0, -1)
  }
}

let demoFocused = $ref(false)

const demoCardRef = $ref<HTMLElement | null>(null)

function focusDemoCard() {
  demoCardRef?.focus()
}

const playDemoKeyboard = usePlayKeyboardAudio()
const playDemoBeep = usePlayBeep()
const playDemoCorrect = usePlayCorrect()


useSeoMeta({ title: () => 'TypeWords' })
</script>

<template>
  <div class="home" id="wrapper">
    <header class="home-header">
      <NuxtLink to="/" class="home-brand">{{ APP_NAME }}</NuxtLink>
      <button class="menu-button" type="button" :aria-expanded="mobileMenuOpen" aria-controls="home-navigation" aria-label="展开或收起导航" @click="mobileMenuOpen = !mobileMenuOpen">
        <IconFluentNavigation20Regular />
      </button>
      <nav id="home-navigation" :class="{ open: mobileMenuOpen }" aria-label="主导航">
        <NuxtLink to="/words">{{ $t('nav_words') }}</NuxtLink>
        <NuxtLink to="/articles">{{ $t('nav_articles') }}</NuxtLink>
        <NuxtLink to="/doc">{{ $t('nav_resources') }}</NuxtLink>
        <NuxtLink to="/help">{{ $t('nav_help') }}</NuxtLink>
      </nav>
      <a :href="GITHUB" target="_blank" rel="noopener noreferrer" class="source-link">GitHub</a>
    </header>

    <main class="home-main">
      <section class="home-intro" aria-labelledby="home-title">
        <h1 id="home-title">{{ APP_NAME }}</h1>
        <h2>{{ $t('hero_tagline') }}</h2>
        <p class="home-description">{{ $t('hero_desc') }}</p>
        <div class="home-actions">
          <NuxtLink to="/words" class="primary-action">{{ $t('hero_cta_start') }} <span aria-hidden="true">→</span></NuxtLink>
          <NuxtLink to="/dict-list" class="secondary-action">{{ $t('home_browse_content') }}</NuxtLink>
        </div>
        <p class="home-note">{{ $t('home_keyboard_note') }}</p>
      </section>

      <section class="demo" aria-label="单词打字体验">
        <div class="demo-heading">
          <span>{{ $t('home_try_typing') }}</span>
          <span class="demo-count">{{ demoIdx + 1 }} / {{ demoWords.length }}</span>
        </div>
        <div ref="demoCardRef" class="demo-input" :class="{ focused: demoFocused }" tabindex="0" role="textbox" :aria-label="$t('demo_typing_hint')" aria-multiline="false" @focus="demoFocused = true" @blur="demoFocused = false" @click="focusDemoCard()" @keydown="onDemoKey" @keydown.backspace="onDemoBackspace">
          <div class="demo-phonetic">{{ demoWord.phonetic }}</div>
          <div class="demo-word" :class="{ 'demo-shake': demoShake }"><span class="demo-correct">{{ demoInput }}</span><span class="demo-wrong">{{ demoWrong }}</span><span class="demo-remaining">{{ demoRemain }}</span></div>
          <div class="demo-definition">{{ demoWord.trans }}</div>
          <div class="demo-hint" role="status">
            <template v-if="demoDone">{{ $t('demo_done') }} {{ $t('demo_press_space_next') }}</template>
            <template v-else>{{ demoFocused ? $t('demo_typing_hint') : $t('demo_click_guide') }}</template>
          </div>
        </div>
        <div class="demo-examples">
          <div v-for="(example, index) in demoWord.examples" :key="index" class="demo-example">
            <p lang="en">{{ example.en }}</p>
            <p>{{ example.zh }}</p>
          </div>
        </div>
      </section>
    </main>

    <div class="home-growth"><GrowthOverview /></div>

    <footer class="home-footer">
      <span>{{ $t('home_free_note') }}</span>
      <span><template v-if="dictionaryCount !== null">{{ dictionaryCount }} {{ $t('home_dictionary_count') }} · </template>{{ $t('home_reading_levels') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.home {
  --home-bg: #f7f7f7;
  --home-surface: #fff;
  --home-text: #252525;
  --home-muted: #636363;
  --home-line: #dadada;
  --home-inverse: #fff;
  min-height: 100svh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 0 32px;
  background: var(--home-bg);
  color: var(--home-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
:global(html.dark) .home {
  --home-bg: #1c1c1c;
  --home-surface: #252525;
  --home-text: #e8e8e8;
  --home-muted: #b5b5b5;
  --home-line: #424242;
  --home-inverse: #1c1c1c;
}
.home a { color: inherit; text-decoration: none; }
.home a:hover { text-decoration: underline; text-underline-offset: 5px; }
.home :is(a, button, [tabindex]):focus-visible { outline: 2px solid var(--home-text); outline-offset: 5px; }
.home-header, .home-main, .home-footer, .home-growth { width: 100%; max-width: 1120px; margin: 0 auto; box-sizing: border-box; }
.home-header { min-height: 80px; display: flex; align-items: center; gap: 48px; border-bottom: 1px solid var(--home-line); }
.home-brand { font-weight: 650; font-size: 19px; letter-spacing: -0.5px; }
.home-header nav { display: flex; gap: 28px; font-size: 14px; color: var(--home-muted); }
.source-link { margin-left: auto; font-size: 14px; }
.menu-button { display: none; }
.home-main { flex: 1; display: grid; grid-template-columns: 1fr 440px; align-items: center; gap: 100px; padding: 88px 0; }
.home-intro h1 { font-size: clamp(42px, 5vw, 64px); line-height: 1.12; letter-spacing: -0.035em; font-weight: 600; margin: 0 0 22px; }
.home-intro h2 { font-size: clamp(22px, 2.4vw, 28px); font-weight: 500; line-height: 1.5; margin: 0 0 20px; }
.home-description { color: var(--home-muted); font-size: 16px; line-height: 1.9; max-width: 32em; margin: 0; }
.home-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; margin-top: 34px; }
.home-actions .primary-action { display: inline-flex; align-items: center; justify-content: space-between; gap: 30px; min-height: 48px; padding: 0 22px; box-sizing: border-box; border: 1px solid var(--home-text); border-radius: 5px; background: var(--home-text); color: var(--home-inverse); font-size: 15px; font-weight: 600; }
.home-actions .primary-action:hover { text-decoration: none; opacity: 0.88; }
.secondary-action { font-size: 15px; text-decoration: underline !important; text-underline-offset: 5px; }
.home-note { color: var(--home-muted); font-size: 13px; line-height: 1.8; margin: 24px 0 0; }
.demo { min-width: 0; border: 1px solid var(--home-line); border-radius: 8px; background: var(--home-surface); }
.demo-heading { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid var(--home-line); font-size: 14px; }
.demo-count { color: var(--home-muted); font-variant-numeric: tabular-nums; }
.demo-input { text-align: center; padding: 34px 24px 22px; cursor: text; border-radius: 3px; outline-offset: -5px !important; }
.demo-input.focused { outline: 1px solid var(--home-text); }
.demo-phonetic { font-size: 14px; color: var(--home-muted); }
.demo-word { font-family: Georgia, 'Times New Roman', serif; font-size: 46px; line-height: 1.4; margin: 8px 0 10px; white-space: nowrap; }
.demo-remaining { color: var(--home-muted); }
.demo-correct { color: var(--home-text); }
.demo-wrong { color: #c33e36; }
.demo-definition { font-size: 14px; line-height: 1.7; }
.demo-hint { min-height: 20px; margin-top: 22px; font-size: 12px; line-height: 1.7; color: var(--home-muted); }
.demo-examples { border-top: 1px solid var(--home-line); margin: 0 24px; padding: 20px 0 24px; }
.demo-example + .demo-example { margin-top: 18px; }
.demo-example p { margin: 0; font-size: 13px; line-height: 1.8; }
.demo-example p + p { color: var(--home-muted); margin-top: 3px; }
.home-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 22px 0; border-top: 1px solid var(--home-line); font-size: 12px; line-height: 1.8; color: var(--home-muted); }
.demo-shake { animation: input-error 160ms linear; }
@keyframes input-error { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
@media (max-width: 1000px) {
  .home-main { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; }
  .demo-word { font-size: 38px; }
}
@media (max-width: 700px) {
  .home { padding: 0 22px; }
  .home-header { min-height: 68px; gap: 20px; flex-wrap: wrap; }
  .menu-button { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: inherit; min-width: 44px; min-height: 44px; margin-left: auto; cursor: pointer; font-size: 22px; }
  .source-link { margin-left: 0; }
  .home-header nav { display: none; order: 4; width: 100%; flex-wrap: wrap; gap: 0; padding-bottom: 14px; }
  .home-header nav.open { display: flex; }
  .home-header nav a { min-height: 44px; display: flex; align-items: center; margin-right: 28px; }
  .home-main { grid-template-columns: minmax(0, 1fr); gap: 44px; padding: 52px 0; }
  .home-intro h1 { margin-bottom: 18px; }
  .home-actions { gap: 20px; margin-top: 28px; }
  .demo-word { font-size: 42px; }
  .demo-input { padding: 28px 18px 20px; }
  .home-footer { flex-direction: column; gap: 4px; }
}
@media (prefers-reduced-motion: reduce) { .demo-shake { animation: none; } }
</style>
