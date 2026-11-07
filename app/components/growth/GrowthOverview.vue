<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGrowthStore, dictionaryGrowthId } from '@/core/stores/growth'
import { useBaseStore } from '@/core/stores/base'
import { Toast } from '@/base'
import { GROWTH_STAGES, formatGrowthGap, milestoneFeedback } from '@/core/growth/presentation'
import DictionaryMilestones from './DictionaryMilestones.vue'

const growth = useGrowthStore()
const base = useBaseStore()
const clock = ref(Date.now())
let interval: ReturnType<typeof setInterval>
let claiming = false
const plan = computed<any>(
  () => growth.state.plans[dictionaryGrowthId(base.sdict)] || Object.values(growth.state.plans).at(-1)
)
const remaining = computed(() =>
  growth.current
    ? Math.max(0, growth.current.conditions.eligibleAt - (growth.state.now + clock.value - growth.receivedAt))
    : 0
)
async function prepare() {
  try {
    await growth.load()
    if (base.load) await growth.ensurePlan(base.sdict, base.getIgnoreWordsSet())
    await claim()
  } catch {}
}
async function claim() {
  if (claiming || !plan.value?.milestones.some((m: any) => !m.notified)) return
  claiming = true
  try {
    const data = await growth.act({ op: 'claimMilestones', dictionaryId: plan.value.id })
    const marks = data.notifications || []
    if (marks.length)
      Toast.success(`${marks.at(-1).dictionaryName} · ${marks.at(-1).name}：${milestoneFeedback(marks.at(-1))}`, {
        duration: 8000,
      })
  } catch (error) {
    console.error('[growth] 阶段反馈暂未确认', error)
  } finally {
    claiming = false
  }
}
watch(
  () => [base.load, base.sdict.id, base.sdict.words.length],
  () => {
    if (base.load) void prepare()
  }
)
watch(() => plan.value?.milestones.filter((m: any) => !m.notified).length, claim)
onMounted(() => {
  void prepare()
  interval = setInterval(() => {
    clock.value = Date.now()
  }, 1000)
})
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <section class="growth-overview" aria-label="成长任务与词典里程碑">
    <div class="evidence-overview">
      <div class="eyebrow">按自己的节奏积累</div>
      <div class="overview-title">
        <h2>5 词 · 7 次成功证据</h2>
        <b>{{ growth.current?.awards.length || 0 }}/7</b>
      </div>
      <p v-if="!growth.current">围绕同一组词，验证认出、听懂、拼写和用法。分多次完成，不需要连续 7 天。</p>
      <template v-else>
        <ol class="evidence-dots">
          <li
            v-for="(label, index) in GROWTH_STAGES"
            :key="label"
            :class="{ earned: growth.current.awards.some((a: any) => a.stage === index + 1) }"
          >
            <span>{{ growth.current.awards.some((a: any) => a.stage === index + 1) ? '✓' : index + 1 }}</span
            >{{ label.replace('我能', '') }}
          </li>
        </ol>
        <p v-if="growth.current.awards.length">
          最近一次：{{ growth.current.awards.at(-1).label }}，独立答对 {{ growth.current.awards.at(-1).count }}/5。
          <span v-if="growth.current.awards.at(-1).stage > 1">验证前间隔 {{ formatGrowthGap(growth.current.awards.at(-1).gap) }}。</span>
        </p>
        <p v-if="growth.current.awards.length === 7">这组词的七次成功都已记录，可以查看具体表现。</p>
        <p v-else-if="growth.current.activeAttempt">有一轮作答已保存，可以继续；原来的首答和成功记录都保留着。</p>
        <p v-else-if="growth.current.conditions.needsPractice">
          下一项：{{ growth.current.conditions.label }}。先练习这组词，再独立验证。
        </p>
        <p v-else-if="remaining">
          下一项：{{ growth.current.conditions.label }}。距可验证还需
          {{ formatGrowthGap(remaining) }}；可以先休息或学习其他词。
        </p>
        <p v-else>下一项：{{ growth.current.conditions.label }}。间隔已满足，可以开始独立验证。</p>
        <details v-if="growth.current.awards.length">
          <summary>已有证据的具体表现</summary>
          <p v-for="a in growth.current.awards" :key="a.stage">
            {{ a.label }}：独立答对 {{ a.count }}/5<span v-if="a.stage > 1">
              · 验证前间隔 {{ formatGrowthGap(a.gap) }}</span
            >
          </p>
        </details>
      </template>
      <p v-if="growth.error" class="growth-error" role="status">
        {{ growth.error }} <button @click="prepare">重试</button>
      </p>
      <NuxtLink class="growth-action" :to="growth.current ? `/growth/${growth.current.id}` : '/growth'"
        >{{ growth.current ? '继续我的成长任务' : '选择 5 词开始' }} <span aria-hidden="true">→</span></NuxtLink
      >
    </div>
    <DictionaryMilestones v-if="plan" :plan="plan" class="overview-milestones" />
  </section>
</template>

<style scoped>
.growth-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  padding: 24px;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-second);
  color: var(--color-main-text);
  margin: 20px 0;
  box-sizing: border-box;
  width: 100%;
  text-align: left;
}
.evidence-overview {
  flex: 1;
  min-width: min(100%, 320px);
}
.eyebrow {
  font-size: 12px;
  color: var(--color-sub-text);
  margin-bottom: 8px;
}
.overview-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.overview-title h2 {
  font-size: 20px;
  line-height: 1.5;
  margin: 0;
  font-weight: 600;
}
.overview-title b {
  font-size: 23px;
  color: #657f5d;
}
:global(html.dark) .overview-title b {
  color: #aec99f;
}
p {
  font-size: 13px;
  line-height: 1.9;
  margin: 12px 0;
  color: var(--color-sub-text);
}
.evidence-dots {
  padding: 0;
  list-style: none;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin: 18px 0;
  font-size: 11px;
}
.evidence-dots li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.evidence-dots span {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  color: var(--color-sub-text);
}
.evidence-dots .earned span {
  background: #637e5a;
  color: white;
  border-color: #637e5a;
}
.growth-action {
  display: inline-flex;
  align-items: center;
  gap: 24px;
  font-size: 14px;
  color: var(--color-main-text);
  text-decoration: none !important;
  padding: 10px 16px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-card-bg);
}
.growth-action:hover {
  border-color: var(--color-main-text);
}
details {
  font-size: 12px;
  margin-bottom: 14px;
}
summary {
  cursor: pointer;
}
.overview-milestones {
  flex: 1;
  min-width: min(100%, 300px);
  border-left: 1px solid var(--color-line);
  padding-left: 26px;
}
.growth-error {
  color: #b65d3d;
}
.growth-error button {
  background: none;
  border: 0;
  text-decoration: underline;
  color: inherit;
  cursor: pointer;
}
@media (max-width: 760px) {
  .growth-overview {
    padding: 18px;
    gap: 20px;
  }
  .overview-milestones {
    border-left: 0;
    border-top: 1px solid var(--color-line);
    padding: 20px 0 0;
  }
  .evidence-dots {
    gap: 5px;
    font-size: 10px;
  }
  .overview-title h2 {
    font-size: 18px;
  }
}
</style>
