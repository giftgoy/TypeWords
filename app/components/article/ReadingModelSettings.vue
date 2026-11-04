<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { readingRequest } from '@/core/immersive/api.ts'

const endpoint = ref('https://opencode.ai/inference/go/openai/v1/chat/completions')
const model = ref('glm-5.3-flash')
const key = ref('')
const configured = ref(false)
const message = ref('')
const saving = ref(false)
const models = ref<{ id: string; name: string }[]>([])
const loadingModels = ref(false)
const customModel = ref(false)
async function refreshModels() {
  loadingModels.value = true
  try { models.value = (await readingRequest('models')).models }
  catch (error) { message.value = (error as Error).message }
  finally { loadingModels.value = false }
}
function chooseModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  customModel.value = value === '__custom__'
  if (!customModel.value) model.value = value
}
onMounted(async () => {
  try {
    const data = await readingRequest('settings')
    endpoint.value = data.endpoint
    model.value = data.model
    configured.value = data.configured
    await refreshModels()
  } catch (error) { message.value = (error as Error).message }
})
async function save() {
  saving.value = true
  try {
    const data = await readingRequest('settings', { endpoint: endpoint.value, model: model.value, key: key.value })
    configured.value = data.configured
    key.value = ''
    message.value = '模型设置已保存。'
  } catch (error) { message.value = (error as Error).message }
  finally { saving.value = false }
}
</script>
<template>
  <details class="reading-model-settings">
    <summary>模型设置 · {{ configured ? '已连接密钥' : '待配置' }}</summary>
    <form @submit.prevent="save">
      <label>接口地址<input v-model="endpoint" required type="url" /></label>
      <label>模型<select :value="customModel ? '__custom__' : model" @change="chooseModel">
        <option v-if="!models.some(item => item.id === model)" :value="model">{{ model }}</option>
        <option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id }}</option>
        <option value="__custom__">自定义模型</option>
      </select></label>
      <label v-if="customModel">模型 ID<input v-model="model" required /></label>
      <button type="button" :disabled="loadingModels" @click="refreshModels">{{ loadingModels ? '获取模型中…' : `刷新模型列表（${models.length} 个）` }}</button>
      <label>API 密钥<input v-model="key" type="password" autocomplete="new-password" :placeholder="configured ? '已保存；留空保留原密钥' : '输入 OpenCode Go 密钥'" :required="!configured" /></label>
      <p>密钥仅保存在本机服务端。OpenCode Go 主要面向编程代理；如服务拒绝，可填写其他兼容接口。</p>
      <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存模型设置' }}</button>
      <p role="status">{{ message }}</p>
    </form>
  </details>
</template>
<style scoped>
.reading-model-settings { font-family: var(--font-family); font-size: 13px; line-height: 1.6; margin-block: 12px; }
summary { cursor: pointer; color: var(--color-font-3); }
form { max-width: 640px; padding-block: 12px; }
label { display: grid; gap: 4px; margin-bottom: 10px; }
input, select { padding: 8px; color: var(--color-main-text); background: var(--color-second); border: 1px solid var(--color-line); border-radius: 6px; min-width: 0; }
button { padding: 8px 12px; background: var(--color-main-text); color: var(--color-second); border-radius: 6px; cursor: pointer; }
p { color: var(--color-font-3); }
</style>
