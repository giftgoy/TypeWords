<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useGrowthStore } from '@/core/stores/growth'
import { GROWTH_STAGES, formatGrowthGap, growthResultText } from '@/core/growth/presentation'
import { withAppBaseURL } from '@/core/utils/base-url'
import '@/assets/css/growth.scss'

useHead({ title: '我的五词成长任务 · TypeWords' })
const growth = useGrowthStore()
const route = useRoute()
const router = useRouter()
const round = computed<any>(() => growth.state.rounds.find((r: any) => r.id === route.params.id))
const attempt = computed<any>(() => (round.value?.current ? round.value.activeAttempt : null))
const question = computed<any>(() => attempt.value?.question)
const result = computed<any>(() => round.value?.lastResult)
const busy = ref(false)
const error = ref('')
const answer = ref('')
const learning = ref(false)
const feedback = ref<any>(null)
const audioBusy = ref(false)
const audioError = ref('')
const clock = ref(Date.now())
const showMethod = ref(false)
const methodStage = ref(0)
const methods = ref<string[]>([])
const finalConfidence = ref<number | null>(null)
const showConfidence = ref(false)
let promptBusy = false
let timer: ReturnType<typeof setInterval>
let audio: HTMLAudioElement | undefined
let audioGeneration = 0
const remaining = computed(() =>
  round.value
    ? Math.max(0, round.value.conditions.eligibleAt - (growth.state.now + clock.value - growth.receivedAt))
    : 0
)
const currentAward = computed(() => round.value?.awards.at(-1))

async function post(body: any) {
  error.value = ''
  return growth.act({ roundId: round.value.id, ...body })
}
async function perform(action: () => Promise<any>) {
  if (busy.value) return
  busy.value = true
  try {
    return await action()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function prompts() {
  if (promptBusy || attempt.value || !round.value) return
  promptBusy = true
  try {
    if (currentAward.value && !currentAward.value.methodAskedAt && !currentAward.value.methodAnswered) {
      const stage = currentAward.value.stage
      const data = await post({ op: 'methodPrompt', stage })
      if (data.showMethodQuestion) {
        methodStage.value = stage
        showMethod.value = true
        methods.value = []
      }
    }
    if (
      round.value.awards.length === 7 &&
      !round.value.confidenceAfterAskedAt &&
      !round.value.confidenceAfterAnswered
    ) {
      const data = await post({ op: 'confidencePrompt' })
      showConfidence.value = data.showConfidenceQuestion
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    promptBusy = false
  }
}
watch(
  () => [round.value?.awards.length, !!attempt.value],
  () => void prompts()
)
watch(
  () => question.value?.id,
  async id => {
    answer.value = ''
    audioError.value = ''
    stopAudio()
    await nextTick()
    if (id) document.querySelector('[aria-label="当前题目"]')?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }
)
watch(
  () => result.value?.attemptId,
  async () => {
    await nextTick()
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
)
onMounted(async () => {
  try {
    await growth.load()
    await prompts()
  } catch (e: any) {
    error.value = e.message
  }
  timer = setInterval(() => {
    clock.value = Date.now()
  }, 1000)
  document.addEventListener('visibilitychange', recordLearningContact)
})
function recordLearningContact() {
  if (learning.value && round.value) return growth.contact(round.value.wordIds, crypto.randomUUID()).catch(() => {})
}
onBeforeRouteLeave(async () => {
  await recordLearningContact()
})
function stopAudio() {
  audioGeneration++
  audio?.pause()
  audio = undefined
  audioBusy.value = false
}
onUnmounted(() => {
  clearInterval(timer)
  stopAudio()
  document.removeEventListener('visibilitychange', recordLearningContact)
})

async function saveMethod(skip = false) {
  await post({ op: 'method', stage: methodStage.value, methods: skip ? null : methods.value })
  showMethod.value = false
}
function toggleMethod(method: string) {
  if (method === '不确定') {
    methods.value = methods.value.includes(method) ? [] : [method]
    return
  }
  methods.value = methods.value.filter(v => v !== '不确定')
  methods.value = methods.value.includes(method) ? methods.value.filter(v => v !== method) : [...methods.value, method]
}
async function start(mode: 'practice' | 'validation') {
  await perform(async () => {
    if (showMethod.value) await saveMethod(true)
    learning.value = false
    feedback.value = null
    await post({ op: 'start', mode })
  })
}
async function learn() {
  await perform(async () => {
    await growth.contact(round.value.wordIds, crypto.randomUUID())
    learning.value = true
  })
}
async function closeLearning() {
  await perform(async () => {
    await growth.contact(round.value.wordIds, crypto.randomUUID())
    learning.value = false
  })
}
async function submit() {
  if (!question.value || !answer.value.trim()) return
  const qid = question.value.id
  const aid = attempt.value.id
  await perform(async () => {
    const data = await post({ op: 'answer', attemptId: aid, questionId: qid, value: answer.value })
    feedback.value = data.practiceFeedback
    answer.value = ''
    await prompts()
  })
}
async function unsure() {
  answer.value = '不知道'
  await submit()
}
async function assist() {
  await perform(async () => {
    await post({ op: 'assist', attemptId: attempt.value.id })
    learning.value = true
  })
}
async function playAudio(url: string, isQuestion = false) {
  if (audioBusy.value) return
  audioError.value = ''
  audioBusy.value = true
  const generation = ++audioGeneration
  const qid = question.value?.id
  const aid = attempt.value?.id
  audio = new Audio(withAppBaseURL(url))
  audio.onended = async () => {
    if (generation !== audioGeneration) return
    if (isQuestion) {
      try {
        await post({ op: 'audio', attemptId: aid, questionId: qid })
      } catch (e: any) {
        error.value = e.message
      }
    }
    if (generation === audioGeneration) audioBusy.value = false
  }
  audio.onerror = () => {
    if (generation === audioGeneration) {
      audioBusy.value = false
      audioError.value = '发音未能播放，不算答错。请重试或今天结束。'
    }
  }
  try {
    await audio.play()
  } catch {
    if (generation === audioGeneration) {
      audioBusy.value = false
      audioError.value = '浏览器未能开始播放，请点击重试；已有进度保留。'
    }
  }
}
async function endToday() {
  if (showMethod.value) await perform(() => saveMethod(true))
  if (showConfidence.value)
    await perform(async () => {
      await post({ op: 'confidence', value: null })
      showConfidence.value = false
    })
  await router.push('/words')
}
</script>

<template>
  <main class="growth-page" data-growth-player>
    <NuxtLink to="/growth">← 成长任务</NuxtLink>
    <template v-if="round">
      <h1>
        我的 5 词成长任务 <small>{{ round.awards.length }}/7</small>
      </h1>
      <p class="gp-muted">每格记录一种具体能力。已亮的格子会保留，不需要连续 7 天。</p>
      <ol class="gp-stage-list">
        <li
          v-for="(label, i) in GROWTH_STAGES"
          :key="label"
          :class="{ earned: round.awards.some((a: any) => a.stage === i + 1), next: round.awards.length === i }"
        >
          {{ round.awards.length > i ? '✓' : i + 1 }}<br />{{ label }}
        </li>
      </ol>
      <section v-if="!round.current" class="gp-panel">
        <h2>这轮进度已保留</h2>
        <p>继续后，从现在重新计算本项所需间隔；已有成功不减少。原来尚未交完的验证会保留为练习。</p>
        <button class="gp-button primary" :disabled="busy" @click="perform(() => post({ op: 'resume' }))">
          继续这一轮
        </button>
      </section>
      <template v-else-if="attempt && question">
        <section class="gp-panel" aria-label="当前题目">
          <h2>
            {{ GROWTH_STAGES[attempt.stage - 1] }} · {{ attempt.mode === 'practice' ? '针对性练习' : '独立验证' }} ·
            {{ question.index }}/5
          </h2>
          <p class="gp-muted">
            {{
              attempt.mode === 'validation'
                ? '仅首次提交计分，五题结束后统一反馈。想看答案可先转为练习，已有成功不变。'
                : '练习可以看答案，答对记为已纠正；随后再用独立验证确认。'
            }}
          </p>
          <template v-if="feedback">
            <p>
              {{ feedback.label }}：<b>{{ feedback.word }}</b> · {{ feedback.meaning }}
            </p>
            <button class="gp-button primary" @click="feedback = null">继续下一题</button>
          </template>
          <template v-else>
            <div v-if="attempt.mode === 'practice'" class="gp-lesson">
              <p v-if="question.previouslyWrong">先练上次没想起的这个词</p>
              <strong>{{ question.learning.word }}</strong> · {{ question.learning.meaning }}
              <p>
                {{ question.learning.example.text }}<br /><span class="gp-muted">{{
                  question.learning.example.translation
                }}</span>
              </p>
            </div>
            <p class="gp-prompt">{{ question.prompt }}</p>
            <div v-if="question.kind === 'audio'" class="gp-actions">
              <button
                class="gp-button"
                :disabled="busy || audioBusy || question.audioPlays >= 2"
                @click="playAudio(question.audioUrl, true)"
              >
                {{ audioBusy ? '正在播放…' : '播放本题音频' }}</button
              ><span class="gp-muted"
                >成功播放 {{ question.audioPlays }}/2 次{{
                  question.audioPlayed ? '，可以作答' : '；听完后即可作答'
                }}</span
              >
            </div>
            <form @submit.prevent="submit">
              <label v-if="question.kind === 'spelling'"
                >本组对应单词<input
                  class="gp-answer"
                  aria-label="输入完整英文单词"
                  v-model="answer"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="none"
                  :spellcheck="false"
                  :disabled="busy"
              /></label>
              <div v-else class="gp-options" role="group" aria-label="答案选项">
                <button
                  v-for="(option, i) in question.options"
                  :key="option.id"
                  type="button"
                  :aria-pressed="answer === option.id"
                  :disabled="busy || (question.kind === 'audio' && !question.audioPlayed)"
                  @click="answer = option.id"
                >
                  {{ String.fromCharCode(65 + i) }}. {{ option.label }}
                </button>
              </div>
              <div class="gp-actions">
                <button
                  class="gp-button primary"
                  type="submit"
                  :disabled="busy || !answer.trim() || (question.kind === 'audio' && !question.audioPlayed)"
                >
                  {{ busy ? '正在保存…' : '提交本题' }}</button
                ><button
                  class="gp-button"
                  type="button"
                  :disabled="busy || (question.kind === 'audio' && !question.audioPlayed)"
                  @click="unsure"
                >
                  暂不确定
                </button>
              </div>
            </form>
            <button v-if="attempt.mode === 'validation'" class="gp-link" :disabled="busy" @click="assist">
              先看答案，转为练习（本次不点格）
            </button>
            <button
              v-if="attempt.mode === 'validation' && question.kind === 'context'"
              class="gp-link"
              :disabled="busy"
              @click="assist"
            >
              这句题意不清，转为练习并保留进度
            </button>
          </template>
          <div class="gp-actions">
            <button class="gp-button" :disabled="busy" @click="endToday">今天结束，保留进度</button>
          </div>
        </section>
      </template>
      <template v-else>
        <section v-if="result" class="gp-panel" aria-live="polite">
          <h2>
            {{ result.passed ? '这次成功已记录' : result.mode === 'practice' ? '练习记录已保存' : '已有进度都保留着' }}
          </h2>
          <p>{{ growthResultText(result) }}</p>
          <p v-if="result.recovered.length">
            上次没想起的 {{ result.recovered.length }} 个词，这次在{{
              GROWTH_STAGES[result.stage - 1].replace('我能', '')
            }}验证中想起来了。
          </p>
          <button class="gp-link" :disabled="busy" @click="learn">查看逐词反馈与学习卡（会重新计算间隔）</button>
          <p v-if="result.mode === 'practice'" class="gp-muted">
            刚看过答案后的正确只记录为已纠正，不会直接点亮下一格。
          </p>
        </section>
        <section v-if="showMethod" class="gp-panel">
          <h2>这次什么帮助了你？</h2>
          <p class="gp-muted">可以多选或跳过，不影响刚才的成功判定。</p>
          <div class="gp-scores">
            <button
              v-for="m in ['发音', '词根', '例句', '提取练习', '不确定']"
              :key="m"
              :aria-pressed="methods.includes(m)"
              @click="toggleMethod(m)"
            >
              {{ m }}
            </button>
          </div>
          <div class="gp-actions">
            <button class="gp-button" :disabled="busy || !methods.length" @click="perform(() => saveMethod())">
              记下方法</button
            ><button class="gp-link" :disabled="busy" @click="perform(() => saveMethod(true))">跳过</button>
          </div>
        </section>
        <section v-if="round.awards.length < 7" class="gp-panel">
          <h2>下一项：{{ round.conditions.label }}</h2>
          <p v-if="round.conditions.needsPractice">先提供这项能力的练习，词量仍为同一组 5 个。</p>
          <p v-else-if="remaining">已完成的证据不会减少。距离可独立验证还需 {{ formatGrowthGap(remaining) }}。</p>
          <p v-else>所需间隔已满足，可以独立验证。同一轮首次答对至少 4/5，就记录这项成功。</p>
          <p class="gp-muted">再次查看或练习这组词，会从最近一次接触后重新计算间隔。等待时日常推荐会暂时安排其他词。</p>
          <p v-if="learning" class="gp-muted">请先收起学习卡，再等待所需间隔后独立验证。</p>
          <div class="gp-actions">
            <button
              class="gp-button primary"
              :disabled="busy || learning || round.conditions.needsPractice || remaining > 0"
              @click="start('validation')"
            >
              开始独立验证</button
            ><button class="gp-button" :disabled="busy" @click="start('practice')">
              {{ result && !result.passed ? '针对性练习' : '先练习这组词' }}</button
            ><button class="gp-button" :disabled="busy" @click="learn">查看 5 词学习卡</button
            ><button class="gp-button" :disabled="busy" @click="endToday">今天结束</button>
          </div>
        </section>
        <section v-if="learning" class="gp-panel">
          <h2>这次仍然只学这 5 个词</h2>
          <button class="gp-button" :disabled="busy" @click="closeLearning">收起学习卡，开始等待间隔</button>
          <ul v-if="result" class="gp-result-words">
            <li v-for="row in result.answers" :key="row.questionId">
              {{ row.correct ? '✓' : '○' }} {{ row.word }} · {{ row.meaning
              }}{{ result.recovered.includes(row.word) ? ' · 上次没想起，这次想起来了' : '' }}
            </li>
          </ul>
          <div class="gp-grid">
            <article v-for="w in round.words" :key="w.id" class="gp-lesson">
              <strong>{{ w.word }}</strong>
              <p>{{ w.meaning }}</p>
              <button
                class="gp-button"
                :disabled="audioBusy"
                @click="playAudio('/api/tts/speak?voice=en-US-AriaNeural&text=' + w.word)"
              >
                听发音
              </button>
              <p v-for="e in w.examples" :key="e.id" class="example">
                {{ e.text }}<br /><span class="gp-muted">{{ e.translation }}</span>
              </p>
            </article>
          </div>
        </section>
        <section v-if="round.awards.length === 7" class="gp-panel">
          <h2>七次成功证据都已保存</h2>
          <p>你完成了这一轮。可以查看每次的独立表现，也可以选择下一组类似单词。</p>
          <p>
            开始前信心：{{ round.confidenceBefore === null ? '未回答' : round.confidenceBefore + '/10' }} · 结束后：{{
              round.confidenceAfter === null ? '未回答' : round.confidenceAfter + '/10'
            }}
          </p>
          <p v-if="round.confidenceBefore !== null && round.confidenceAfter !== null">
            信心变化：{{ round.confidenceAfter - round.confidenceBefore > 0 ? '+' : ''
            }}{{ round.confidenceAfter - round.confidenceBefore }} 分。按真实变化记录，不代表产品造成了这个变化。
          </p>
          <button
            v-if="!round.confidenceAfterAnswered && !showConfidence"
            class="gp-button"
            @click="showConfidence = true"
          >
            补充结束信心评分</button
          ><NuxtLink class="gp-button" to="/growth">选择下一组</NuxtLink>
        </section>
        <section v-if="showConfidence" class="gp-panel">
          <h2>你有多大信心学会下一组类似单词？</h2>
          <p>0～10 分。可以跳过，七次成功已经保存。</p>
          <div class="gp-scores">
            <button v-for="n in 11" :key="n" :aria-pressed="finalConfidence === n - 1" @click="finalConfidence = n - 1">
              {{ n - 1 }}
            </button>
          </div>
          <div class="gp-actions">
            <button
              class="gp-button primary"
              :disabled="busy || finalConfidence === null"
              @click="
                perform(async () => {
                  await post({ op: 'confidence', value: finalConfidence })
                  showConfidence = false
                })
              "
            >
              保存评分</button
            ><button
              class="gp-link"
              :disabled="busy"
              @click="
                perform(async () => {
                  await post({ op: 'confidence', value: null })
                  showConfidence = false
                })
              "
            >
              暂不回答
            </button>
          </div>
        </section>
        <section v-if="round.awards.length" class="gp-panel">
          <h2>已有的具体证据</h2>
          <p v-for="a in round.awards" :key="a.stage">
            {{ a.stage }}. {{ a.label }} · 首次通过 {{ a.count }}/5<span v-if="a.stage > 1">
              · 验证前间隔 {{ formatGrowthGap(a.gap) }}</span
            >
          </p>
          <p class="gp-muted">第一次通过不重复计数，复习和纠错仍可继续。</p>
        </section>
      </template>
    </template>
    <p v-else class="gp-muted">
      {{ growth.loaded ? '这轮记录暂不可用，请返回任务列表查看。' : '正在读取已保存的进度…' }}
    </p>
    <p v-if="error || audioError" class="gp-error" role="alert">{{ error || audioError }}</p>
  </main>
</template>
