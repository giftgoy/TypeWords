<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BaseButton, Switch, Toast } from '@/base'

const { t: $t } = useI18n()

type Status = {
  configured: boolean
  repo: string | null
  branch: string
  path: string
  snapshotDir: string
  autoPush: boolean
  source: 'env' | 'file' | 'none'
  hasToken: boolean
  tokenHint: string
  lastSyncAt: string | null
  lastError: string | null
  lastSnapshot: string | null
}

const status = ref<Status | null>(null)
const loading = ref(false)
const backingUp = ref(false)
const restoring = ref(false)
const saving = ref(false)
const editing = ref(false)
const loadError = ref('')

const form = ref({ repo: '', token: '', branch: 'master', path: 'typewords/progress.json', autoPush: true })

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch('/api/data/github/status', { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    status.value = await response.json()
    if (!editing.value && status.value) {
      form.value.repo = status.value.repo || ''
      form.value.branch = status.value.branch || 'master'
      form.value.path = status.value.path || 'typewords/progress.json'
      form.value.autoPush = status.value.autoPush
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    status.value = null
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  if (!form.value.repo.trim()) return Toast.error($t('github_repo_required'))
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      repo: form.value.repo.trim(),
      branch: form.value.branch.trim() || 'master',
      path: form.value.path.trim() || 'typewords/progress.json',
      autoPush: form.value.autoPush,
    }
    if (form.value.token.trim()) body.token = form.value.token.trim()
    const response = await fetch('/api/data/github/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || String(response.status))
    form.value.token = ''
    editing.value = false
    status.value = data
    Toast.success($t('github_config_saved'))
  } catch (error) {
    Toast.error($t('github_config_failed') + (error instanceof Error ? `（${error.message}）` : ''))
  } finally {
    saving.value = false
  }
}

async function clearConfig() {
  if (!window.confirm($t('github_clear_confirm'))) return
  try {
    const response = await fetch('/api/data/github/config', { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || String(response.status))
    status.value = data
    editing.value = false
    Toast.success($t('github_config_cleared'))
  } catch (error) {
    Toast.error($t('github_config_failed') + (error instanceof Error ? `（${error.message}）` : ''))
  }
}

async function backupNow() {
  backingUp.value = true
  try {
    const response = await fetch('/api/data/github/backup', { method: 'POST' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || String(response.status))
    Toast.success($t('github_backup_done'))
    await refresh()
  } catch (error) {
    Toast.error($t('github_backup_failed') + (error instanceof Error ? `（${error.message}）` : ''))
  } finally {
    backingUp.value = false
  }
}

async function restoreFromCloud() {
  if (!window.confirm($t('github_restore_confirm'))) return
  restoring.value = true
  try {
    const response = await fetch('/api/data/github/restore', { method: 'POST' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || String(response.status))
    Toast.success($t('github_restore_done'))
    setTimeout(() => location.reload(), 1200)
  } catch (error) {
    Toast.error($t('github_restore_failed') + (error instanceof Error ? `（${error.message}）` : ''))
  } finally {
    restoring.value = false
  }
}

function formatTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

onMounted(refresh)
</script>

<template>
  <div>
    <div class="flex items-center gap-3 flex-wrap">
      <div class="text-lg font-semibold">{{ $t('github_backup') }}</div>
      <span
        v-if="status"
        class="text-xs px-2 py-1 rounded"
        :class="status.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 color-gray'"
      >
        {{ status.configured ? $t('github_configured') : $t('github_not_configured') }}
      </span>
      <span v-if="status?.source === 'file'" class="text-xs color-gray">{{ $t('github_source_ui') }}</span>
      <span v-else-if="status?.source === 'env'" class="text-xs color-gray">{{ $t('github_source_env') }}</span>
    </div>
    <p class="text-sm color-gray mt-1">{{ $t('github_backup_desc') }}</p>

    <div v-if="loadError" class="text-sm text-red mt-2">{{ $t('github_status_failed') }}（{{ loadError }}）</div>

    <div v-if="status && status.configured && !editing" class="text-sm mt-3 flex flex-col gap-1">
      <div>
        仓库：<span class="font-medium">{{ status.repo }}</span> · 分支 {{ status.branch }} · 路径 {{ status.path }}
        <span v-if="status.hasToken" class="color-gray">· Token {{ status.tokenHint }}</span>
      </div>
      <div>{{ status.autoPush ? $t('github_auto_on') : $t('github_auto_off') }}</div>
      <div>{{ $t('github_last_sync') }}：{{ formatTime(status.lastSyncAt) }}</div>
      <div v-if="status.lastSnapshot">{{ $t('github_last_snapshot') }}：{{ status.lastSnapshot }}</div>
      <div v-if="status.lastError" class="text-red">{{ $t('github_last_error') }}：{{ status.lastError }}</div>
    </div>

    <div v-if="editing || !status?.configured" class="mt-3 flex flex-col gap-2 max-w-140">
      <label class="text-sm flex flex-col gap-1">
        <span>{{ $t('github_field_repo') }}</span>
        <input v-model="form.repo" class="gh-input" placeholder="your-name/typewords-backup" />
      </label>
      <label class="text-sm flex flex-col gap-1">
        <span>{{ $t('github_field_token') }}</span>
        <input
          v-model="form.token"
          class="gh-input"
          type="password"
          autocomplete="off"
          :placeholder="status?.hasToken ? $t('github_token_keep') : 'github_pat_...'"
        />
      </label>
      <div class="flex gap-3 flex-wrap">
        <label class="text-sm flex flex-col gap-1 flex-1 min-w-40">
          <span>{{ $t('github_field_branch') }}</span>
          <input v-model="form.branch" class="gh-input" placeholder="master" />
        </label>
        <label class="text-sm flex flex-col gap-1 flex-1 min-w-40">
          <span>{{ $t('github_field_path') }}</span>
          <input v-model="form.path" class="gh-input" placeholder="typewords/progress.json" />
        </label>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <Switch v-model="form.autoPush" />
        <span>{{ $t('github_field_auto') }}</span>
      </div>
      <div class="flex gap-3 mt-1 flex-wrap">
        <BaseButton size="large" :loading="saving" @click="saveConfig">{{ $t('github_save_config') }}</BaseButton>
        <BaseButton v-if="status?.configured" size="large" @click="editing = false">{{ $t('github_cancel') }}</BaseButton>
        <BaseButton v-if="status?.configured" size="large" @click="clearConfig">{{ $t('github_clear_config') }}</BaseButton>
      </div>
    </div>

    <div class="flex gap-3 mt-4 flex-wrap">
      <BaseButton v-if="status?.configured" size="large" :loading="backingUp" @click="backupNow">
        {{ $t('github_backup_now') }}
      </BaseButton>
      <BaseButton v-if="status?.configured" size="large" :loading="restoring" @click="restoreFromCloud">
        {{ $t('github_restore') }}
      </BaseButton>
      <BaseButton v-if="status?.configured" size="large" @click="editing = !editing">{{ $t('github_edit_config') }}</BaseButton>
      <BaseButton size="large" :loading="loading" @click="refresh">{{ $t('github_refresh') }}</BaseButton>
    </div>

    <div class="line my-3"></div>
  </div>
</template>

<style scoped>
.gh-input {
  height: 2.2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--color-line);
  border-radius: 0.4rem;
  background: var(--color-bg);
  color: inherit;
  outline: none;
}
.gh-input:focus {
  border-color: var(--color-primary);
}
</style>
