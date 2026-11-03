<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BaseButton, Toast } from '@/base'

const { t: $t } = useI18n()

type Status = {
  configured: boolean
  repo: string | null
  branch: string
  path: string
  snapshotDir: string
  autoPush: boolean
  lastSyncAt: string | null
  lastError: string | null
  lastSnapshot: string | null
}

const status = ref<Status | null>(null)
const loading = ref(false)
const backingUp = ref(false)
const restoring = ref(false)
const loadError = ref('')

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch('/api/data/github/status', { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    status.value = await response.json()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    status.value = null
  } finally {
    loading.value = false
  }
}

async function backupNow() {
  backingUp.value = true
  try {
    const response = await fetch('/api/data/github/backup', { method: 'POST' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || body.message || String(response.status))
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
    if (!response.ok) throw new Error(body.error || body.message || String(response.status))
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
      <span v-if="status" class="text-xs px-2 py-1 rounded" :class="status.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 color-gray'">
        {{ status.configured ? $t('github_configured') : $t('github_not_configured') }}
      </span>
    </div>
    <p class="text-sm color-gray mt-1">{{ $t('github_backup_desc') }}</p>

    <div v-if="loadError" class="text-sm text-red mt-2">
      {{ $t('github_status_failed') }}（{{ loadError }}）
    </div>

    <div v-if="status && status.configured" class="text-sm mt-3 flex flex-col gap-1">
      <div>仓库：<span class="font-medium">{{ status.repo }}</span> · 分支 {{ status.branch }} · 路径 {{ status.path }}</div>
      <div>{{ status.autoPush ? $t('github_auto_on') : $t('github_auto_off') }}</div>
      <div>{{ $t('github_last_sync') }}：{{ formatTime(status.lastSyncAt) }}</div>
      <div v-if="status.lastSnapshot">{{ $t('github_last_snapshot') }}：{{ status.lastSnapshot }}</div>
      <div v-if="status.lastError" class="text-red">{{ $t('github_last_error') }}：{{ status.lastError }}</div>
    </div>

    <div class="flex gap-3 mt-4 flex-wrap">
      <BaseButton size="large" :loading="backingUp" :disabled="!status?.configured" @click="backupNow">
        {{ $t('github_backup_now') }}
      </BaseButton>
      <BaseButton size="large" :loading="restoring" :disabled="!status?.configured" @click="restoreFromCloud">
        {{ $t('github_restore') }}
      </BaseButton>
      <BaseButton size="large" :loading="loading" @click="refresh">{{ $t('github_refresh') }}</BaseButton>
    </div>

    <div class="line my-3"></div>
  </div>
</template>
