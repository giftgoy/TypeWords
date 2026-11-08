<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { readingRequest } from '@/core/immersive/api.ts'

/** AI 配置现在统一在「设置 → AI 模型」里；这里只提示是否已配好。 */

const configured = ref(false)
const checking = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const data = await readingRequest('settings')
    configured.value = Boolean(data.configured)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    checking.value = false
  }
})
</script>

<template>
  <p class="ai-model-status" :class="{ 'is-warn': !checking && !configured && !error, 'is-error': !!error }">
    <IconFluentSparkle20Regular class="ai-model-status__icon" />
    <span v-if="checking">正在检查 AI 模型配置…</span>
    <span v-else-if="error">{{ error }}</span>
    <span v-else-if="configured">AI 模型已连接，接口、模型和密钥都在「设置 → AI 模型」里管理。</span>
    <template v-else>
      <span>还没有配置 AI 模型，这项功能暂时用不了。</span>
      <NuxtLink to="/setting?index=4">去设置里配置</NuxtLink>
    </template>
  </p>
</template>

<style scoped>
.ai-model-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-3);
}

.ai-model-status.is-warn {
  color: #b45309;
}

.ai-model-status.is-error {
  color: #dc2626;
}

.ai-model-status__icon {
  font-size: 14px;
  flex: none;
}

.ai-model-status a {
  color: var(--color-link);
  text-decoration: underline;
}
</style>
