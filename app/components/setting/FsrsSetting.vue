<script setup lang="ts">
import { InputNumber, Switch } from '@/base'
import SettingItem from './SettingItem.vue'
import { useSettingStore } from '@/core/stores/setting'
const settings = useSettingStore()
</script>
<template>
  <div class="fsrs-explanation">
    <h2 class="text-xl font-bold mb-3">智能复习（FSRS）</h2>
    <p>学过的词会在合适的时间再次出现。记得越牢，复习间隔越长；容易忘的词会更早回来。</p>
    <p class="my-3">
      默认设置即可开始。每日新词数和“每组最多复习”在学习设置里调整；当天没有到期词时，不会为了凑数安排复习。
    </p>
    <NuxtLink to="/words#learning-records">查看学习记录与日历 →</NuxtLink>
    <details class="mt-6">
      <summary class="cp">高级设置（通常无需修改）</summary>
      <div class="mt-4">
        <p class="text-sm mb-3">以下阈值根据一次练习中的错误次数估计记忆强度。英文名称对应算法内部评分。</p>
        <SettingItem title="很熟悉（Easy）" desc="错误次数不超过此值时，安排较长的复习间隔。"
          ><InputNumber :min="0" :max="settings.fsrsGoodLimit" v-model="settings.fsrsEasyLimit" /><span
            >次错误以内</span
          ></SettingItem
        >
        <SettingItem title="记得（Good）"
          ><InputNumber
            :min="settings.fsrsEasyLimit"
            :max="settings.fsrsHardLimit"
            v-model="settings.fsrsGoodLimit"
          /><span>次错误以内</span></SettingItem
        >
        <SettingItem title="有些吃力（Hard）"
          ><InputNumber :min="settings.fsrsGoodLimit" :max="10" v-model="settings.fsrsHardLimit" /><span
            >次错误以内；更多错误会尽快重学。</span
          ></SettingItem
        >
        <SettingItem title="分散复习日期" desc="轻微调整到期日期，避免大量词集中在同一天。"
          ><Switch v-model="settings.fsrsParameters.enable_fuzz"
        /></SettingItem>
        <SettingItem title="目标记忆率" desc="默认 0.9。提高后通常需要更频繁地复习。"
          ><InputNumber v-model="settings.fsrsParameters.request_retention" :min="0.7" :max="0.99"
        /></SettingItem>
        <SettingItem title="最长复习间隔（天）"
          ><InputNumber v-model="settings.fsrsParameters.maximum_interval" :min="1"
        /></SettingItem>
        <details class="my-4">
          <summary class="cp">算法权重（专业选项）</summary>
          <p class="text-sm my-3">没有经过训练的参数时，建议保留默认值。</p>
          <div v-for="(_, index) in settings.fsrsParameters.w" :key="index" class="my-3">
            <label>权重 {{ index + 1 }} <InputNumber v-model="settings.fsrsParameters.w[index]" /></label>
          </div>
        </details>
      </div>
    </details>
  </div>
</template>
<style scoped>
.fsrs-explanation {
  line-height: 1.9;
  max-width: 720px;
}
</style>
