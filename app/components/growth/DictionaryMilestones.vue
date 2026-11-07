<script setup lang="ts">
import { computed } from 'vue'
import { DICT_MILESTONES, milestoneFeedback } from '@/core/growth/presentation'
const props = defineProps<{ plan: any }>()
const count = computed(() => props.plan.covered.length)
const total = computed(() => props.plan.targets.length)
const percent = computed(() => (total.value ? Math.floor((count.value * 1000) / total.value) / 10 : 0))
const latest = computed(() => props.plan.milestones.at(-1))
</script>

<template>
  <section class="dict-milestones" aria-label="词典阶段进度">
    <div class="milestone-heading">
      <strong>{{ plan.name }}</strong
      ><span>{{ latest?.name || '开始积累' }}</span>
    </div>
    <p v-if="total">
      本轮逐词学习记录 <b>{{ percent }}%</b> · {{ count }}/{{ total }} 词
    </p>
    <p v-else>当前没有待学目标，可以选择其他词典。</p>
    <div
      class="milestone-track"
      :style="{ '--progress': percent + '%' }"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="本轮逐词学习进度"
    >
      <i></i>
    </div>
    <ol class="milestone-checkpoints">
      <li
        v-for="n in DICT_MILESTONES"
        :key="n"
        :class="{ reached: plan.milestones.some((m: any) => m.threshold === n) }"
        :aria-label="`${n}% ${plan.milestones.some((m: any) => m.threshold === n) ? '已达成' : '待积累'}`"
      >
        <span aria-hidden="true">{{ plan.milestones.some((m: any) => m.threshold === n) ? '✓' : '○' }}</span
        >{{ n }}%
      </li>
    </ol>
    <p v-if="latest" class="milestone-feedback">
      达到 {{ latest.threshold }}% · {{ latest.name }}<br />达成时：{{ milestoneFeedback(latest) }}
    </p>
    <p class="milestone-note">
      按完成并保存的去重目标词记录，复习不重复加词数。{{ plan.excluded ? `建计划时排除 ${plan.excluded} 词。` : ''
      }}<span v-if="plan.historicalPercent > 0"
        >旧版历史进度 {{ Math.floor(plan.historicalPercent * 10) / 10 }}% 已保留，以上从本轮开始逐词记录。</span
      >
    </p>
    <details v-if="plan.milestones.length">
      <summary>查看已积累的阶段记录</summary>
      <p v-for="m in plan.milestones" :key="m.id">
        {{ m.threshold }}% · {{ m.name }} · 达成时 {{ m.count }}/{{ m.total }} 词
      </p>
    </details>
  </section>
</template>

<style scoped>
.dict-milestones {
  color: var(--color-main-text);
}
.milestone-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.milestone-heading span {
  font-size: 12px;
  color: var(--color-sub-text);
}
p {
  font-size: 13px;
  line-height: 1.8;
  margin: 12px 0;
}
.milestone-track {
  height: 7px;
  background: var(--color-third);
  border-radius: 6px;
  overflow: hidden;
}
.milestone-track i {
  display: block;
  height: 100%;
  width: var(--progress);
  background: #6b8e63;
  border-radius: 6px;
}
.milestone-checkpoints {
  list-style: none;
  display: flex;
  justify-content: space-between;
  margin: 12px 0;
  padding: 0;
  gap: 8px;
}
.milestone-checkpoints li {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 12px;
  gap: 5px;
  color: var(--color-sub-text);
}
.milestone-checkpoints .reached {
  color: #53744d;
  font-weight: 600;
}
:global(html.dark) .milestone-checkpoints .reached {
  color: #aec99f;
}
.milestone-note,
details {
  font-size: 12px;
  color: var(--color-sub-text);
  line-height: 1.7;
}
summary {
  cursor: pointer;
}
</style>
