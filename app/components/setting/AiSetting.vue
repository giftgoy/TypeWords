<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BaseButton, BaseInput, Option, Select } from '@/base'
import SettingItem from './SettingItem.vue'
import { readingRequest } from '@/core/immersive/api.ts'
import { useSettingStore } from '@/core/stores/setting.ts'

/**
 * AI 模型设置：全站唯一入口。
 * 文章讲解、用目标词写短文、语境校准都读这一份配置；密钥保存在本机
 * typewords-reading 服务端（/data/reading.json），不进浏览器存储。
 */

const settingStore = useSettingStore()

const CUSTOM = '__custom__'
const endpoint = ref('')
const model = ref('')
const key = ref('')
const configured = ref(false)
const models = ref<{ id: string; name: string }[]>([])
const customModel = ref(false)
const loading = ref(true)
const refreshing = ref(false)
const saving = ref(false)
const testing = ref(false)
const message = ref('')
const error = ref('')

const modelChoice = computed({
  get: () => (customModel.value ? CUSTOM : model.value),
  set: value => {
    customModel.value = value === CUSTOM
    if (!customModel.value) model.value = String(value ?? '')
  },
})

function fail(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : String(cause)
  message.value = ''
}

async function load() {
  loading.value = true
  try {
    const data = await readingRequest('settings')
    endpoint.value = data.endpoint
    model.value = data.model
    configured.value = data.configured
    customModel.value = false
    await refreshModels()
  } catch (cause) {
    fail(cause)
  } finally {
    loading.value = false
  }
}

async function refreshModels() {
  refreshing.value = true
  try {
    const data = await readingRequest('models')
    models.value = Array.isArray(data.models) ? data.models : []
    if (models.value.length && !models.value.some(item => item.id === model.value)) customModel.value = true
    error.value = ''
  } catch (cause) {
    fail(cause)
  } finally {
    refreshing.value = false
  }
}

async function save() {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    const data = await readingRequest('settings', {
      endpoint: endpoint.value.trim(),
      model: model.value.trim(),
      key: key.value.trim(),
    })
    configured.value = data.configured
    key.value = ''
    message.value = 'AI 模型设置已保存，文章讲解等功能立即可用。'
  } catch (cause) {
    fail(cause)
  } finally {
    saving.value = false
  }
}

/** 用 /models 探一次：能列出来就说明地址、密钥、额度都通 */
async function test() {
  testing.value = true
  message.value = ''
  error.value = ''
  try {
    const data = await readingRequest('models')
    const count = Array.isArray(data.models) ? data.models.length : 0
    message.value = count ? `连接正常，可用模型 ${count} 个。` : '连接正常，但服务商没有返回模型列表。'
  } catch (cause) {
    fail(cause)
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="ai-setting">
    <SettingItem
      main-title="AI 模型"
      desc="所有 AI 功能（文章讲解、用目标词写短文、语境校准）都共用这里的配置。密钥只保存在本机 typewords-reading 服务的 /data 卷里，不会写进浏览器或同步到别处。"
    >
      <span class="ai-state" :class="configured ? 'is-ok' : 'is-warn'">
        {{ loading ? '读取中…' : configured ? '已连接密钥' : '待配置' }}
      </span>
      <BaseButton type="info" :loading="refreshing" :disabled="loading" @click="refreshModels">
        {{ models.length ? `刷新模型列表（${models.length}）` : '获取模型列表' }}
      </BaseButton>
    </SettingItem>

    <SettingItem title="接口地址" desc="OpenAI 兼容的 Chat Completions 地址，必须以 https:// 开头、以 /chat/completions 结尾。">
      <BaseInput v-model="endpoint" class="w-full!" placeholder="https://…/v1/chat/completions" />
    </SettingItem>

    <SettingItem title="模型" desc="下拉列表来自服务商的 /models；列表里没有时可以手填模型 ID。">
      <Select v-model="modelChoice" class="w-64!" placeholder="请选择模型">
        <Option v-if="model && !models.some(item => item.id === model)" :label="model" :value="model" />
        <Option v-for="item in models" :key="item.id" :label="`${item.name} · ${item.id}`" :value="item.id" />
        <Option label="自定义模型 ID" :value="CUSTOM" />
      </Select>
      <BaseInput v-if="customModel" v-model="model" class="w-64!" placeholder="模型 ID，例如 glm-4.6" />
    </SettingItem>

    <SettingItem
      title="API 密钥"
      :desc="configured ? '已保存过密钥，这里留空表示不修改。换服务商地址时必须重新填写。' : '密钥只存在服务端，保存后页面不会再显示。'"
    >
      <BaseInput
        v-model="key"
        type="password"
        class="w-80!"
        :placeholder="configured ? '已保存；留空保留原密钥' : '粘贴服务商 API Key'"
      />
    </SettingItem>

    <SettingItem title="保存与测试" desc="保存后立即生效；「测试连接」会真实请求一次模型列表，用来确认地址、密钥和额度。">
      <BaseButton :loading="saving" @click="save">保存 AI 设置</BaseButton>
      <BaseButton type="info" :loading="testing" @click="test">测试连接</BaseButton>
    </SettingItem>

    <SettingItem title="讲解语言" desc="AI 讲解里中文说明的语言风格；中英对照会保留英文原句并逐句对照。">
      <Select v-model="settingStore.aiExplainLanguage" class="w-50!" placeholder="请选择">
        <Option label="中文" value="zh" />
        <Option label="中英对照" value="bilingual" />
      </Select>
    </SettingItem>

    <p v-if="error" class="ai-msg is-error" role="alert">{{ error }}</p>
    <p v-else-if="message" class="ai-msg" role="status">{{ message }}</p>
  </div>
</template>

<style scoped lang="scss">
.ai-setting {
  padding-bottom: 2rem;
}

.ai-state {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid var(--color-line);

  &.is-ok {
    color: #15803d;
    border-color: #86efac;
    background: #f0fdf4;
  }

  &.is-warn {
    color: #b45309;
    border-color: #fcd34d;
    background: #fffbeb;
  }
}

.ai-msg {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--color-font-3);

  &.is-error {
    color: #dc2626;
  }
}

html.dark .ai-state.is-ok {
  color: #4ade80;
  border-color: #166534;
  background: rgb(20 83 45 / 30%);
}

html.dark .ai-state.is-warn {
  color: #fbbf24;
  border-color: #92400e;
  background: rgb(120 53 15 / 30%);
}
</style>
