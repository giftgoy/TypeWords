<script setup lang="ts">
import { computed, ref } from 'vue'
import { Dialog, Toast } from '@/base'
import { useBaseStore } from '@/core/stores/base'
import { useSettingStore } from '@/core/stores/setting'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { SyncDataType } from '@/core/types/enum'
import type { Word } from '@/core/types/types'
import { DEFAULT_SIMPLE_WORDS, normalizeWordKey, parseSimpleWords } from '@/core/utils/simple-word-filter'

const props = withDefaults(defineProps<{ words?: Word[]; currentWord?: string; compact?: boolean }>(), {
  words: () => [],
})
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const editing = ref(false)
const saving = ref(false)
const draft = ref('')
const draftEnabled = ref(false)
const savedSet = computed(() => new Set(parseSimpleWords(store.simpleWords)))
const draftWords = computed(() => parseSimpleWords(draft.value))
const matches = computed(() => props.words.filter(word => savedSet.value.has(normalizeWordKey(word.word))))
const draftMatches = computed(() => props.words.filter(word => draftWords.value.includes(normalizeWordKey(word.word))))
const currentKey = computed(() => normalizeWordKey(props.currentWord || ''))
const currentIsSimple = computed(() => savedSet.value.has(currentKey.value))

function openEditor() {
  draft.value = parseSimpleWords(store.simpleWords).join(', ')
  draftEnabled.value = settings.ignoreSimpleWord
  editing.value = true
}
async function saveSetting() {
  await persistence.saveLocalAndSync(SyncDataType.setting, settings.$state, { pullWhenRemoteNewer: false })
}
async function toggleEnabled() {
  if (saving.value) return
  const previous = settings.ignoreSimpleWord
  settings.ignoreSimpleWord = !previous
  saving.value = true
  try {
    await saveSetting()
  } catch {
    settings.ignoreSimpleWord = previous
    Toast.error('设置保存失败，请重试')
  } finally {
    saving.value = false
  }
}
function addCurrentWord() {
  if (!currentKey.value) return
  draft.value = parseSimpleWords([...draftWords.value, currentKey.value]).join(', ')
  draftEnabled.value = true
}
async function saveCurrentWord() {
  const key = currentKey.value
  if (saving.value || !store.load || !key || savedSet.value.has(key)) return
  saving.value = true
  store.simpleWords = parseSimpleWords([...store.simpleWords, key])
  try {
    await persistence.saveDictState(store.$state, { pullWhenRemoteNewer: false })
    Toast.success(settings.ignoreSimpleWord ? '已加入简单词汇列表，练习会自动跳过' : '已加入简单词汇列表，开启剔除后生效')
  } catch {
    store.simpleWords = store.simpleWords.filter(word => normalizeWordKey(word) !== key)
    Toast.error('添加失败，请重试')
  } finally {
    saving.value = false
  }
}
async function applyChanges() {
  saving.value = true
  try {
    store.simpleWords = draftWords.value
    settings.ignoreSimpleWord = draftEnabled.value
    await Promise.all([persistence.saveDictState(store.$state, { pullWhenRemoteNewer: false }), saveSetting()])
    Toast.success('简单词过滤设置已保存')
  } catch {
    Toast.error('保存失败，请重试')
    return false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="simple-filter-control" :class="{ compact }">
    <div class="filter-main">
      <button
        type="button"
        role="switch"
        aria-label="剔除简单词汇"
        :aria-checked="settings.ignoreSimpleWord"
        :disabled="saving || !store.load"
        class="filter-switch"
        @click="toggleEnabled"
      >
        <span class="switch-track" :class="{ enabled: settings.ignoreSimpleWord }" aria-hidden="true"><i></i></span>
        <span>剔除简单词汇</span><b>{{ settings.ignoreSimpleWord ? '已开启' : '已关闭' }}</b>
      </button>
      <div class="filter-actions">
        <button
          v-if="currentKey"
          type="button"
          class="add-simple-word"
          :disabled="saving || !store.load || currentIsSimple"
          :title="currentIsSimple ? '当前单词已在简单词汇列表中' : '将当前单词加入简单词汇列表'"
          @click="saveCurrentWord"
        >
          <IconFluentAdd16Regular v-if="!currentIsSimple" aria-hidden="true" />
          {{ currentIsSimple ? '已在简单词汇中' : '加入简单词汇' }}
        </button>
        <button type="button" class="manage-filter" :disabled="saving || !store.load" @click="openEditor">
          管理名单<span v-if="words.length"> · 命中 {{ matches.length }} 词</span>
        </button>
      </div>
    </div>
    <p v-if="!compact" class="filter-note">按你定义的简单词名单跳过练习，支持随时关闭。词条和已有学习记录都会保留。</p>
  </div>
  <Dialog
    v-model="editing"
    title="简单词过滤"
    padding
    footer
    confirm-button-text="保存并应用"
    :on-confirm="applyChanges"
  >
    <div class="simple-filter-editor">
      <label class="editor-toggle"
        ><input type="checkbox" v-model="draftEnabled" aria-label="启用简单词过滤" />启用简单词过滤</label
      >
      <p class="editor-description">
        名单由你决定，不区分大小写。保存后立即跳过当前练习中的匹配词；关闭后不再过滤，已有进度保持不变。
      </p>
      <div class="editor-actions">
        <button v-if="currentKey" type="button" @click="addCurrentWord" :disabled="draftWords.includes(currentKey)">
          {{ draftWords.includes(currentKey) ? `已包含当前词 ${currentWord}` : `加入当前词 ${currentWord}` }}
        </button>
        <button type="button" @click="draft = DEFAULT_SIMPLE_WORDS.join(', ')">使用默认名单</button>
        <button type="button" @click="draft = ''">清空名单</button>
      </div>
      <label class="editor-label" for="simple-filter-words"
        >简单词名单 <span>{{ draftWords.length }} 个</span></label
      >
      <textarea
        id="simple-filter-words"
        v-model="draft"
        rows="7"
        aria-label="简单词名单"
        placeholder="a, an, the, me&#10;也可以每行一个单词或短语"
        spellcheck="false"
      ></textarea>
      <p class="separator-help">支持中英文逗号、分号、顿号或换行分隔；自动去重，保留短语内的空格。</p>
      <div v-if="words.length" class="filter-preview">
        <strong>本词典将{{ draftEnabled ? '跳过' : '保留' }} {{ draftMatches.length }} 个匹配词</strong>
        <p>
          {{
            draftMatches
              .slice(0, 16)
              .map(word => word.word)
              .join(' · ') || '当前词典没有命中这份名单。'
          }}{{ draftMatches.length > 16 ? ' …' : '' }}
        </p>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.simple-filter-control {
  padding: 15px 0;
  color: var(--color-main-text);
}
.filter-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 5px 0;
}
.filter-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.add-simple-word {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--color-link);
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.add-simple-word:hover:enabled {
  background: var(--color-third);
}
.add-simple-word:focus-visible {
  outline: 2px solid var(--color-link);
  outline-offset: 2px;
}
.add-simple-word:disabled {
  color: var(--color-sub-text);
  cursor: default;
  opacity: 0.6;
}
.filter-switch:disabled {
  opacity: 0.5;
  cursor: wait;
}
.filter-switch b {
  font-size: 11px;
  font-weight: normal;
  color: var(--color-sub-text);
}
.switch-track {
  width: 32px;
  height: 19px;
  border-radius: 12px;
  background: var(--color-third);
  padding: 3px;
  box-sizing: border-box;
  transition: background 0.2s;
}
.switch-track i {
  display: block;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px #0002;
  transition: transform 0.2s;
}
.switch-track.enabled {
  background: #756ad8;
}
.switch-track.enabled i {
  transform: translateX(13px);
}
.manage-filter {
  padding: 5px 0;
  color: var(--color-link);
  background: none;
  border: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.manage-filter span {
  color: var(--color-sub-text);
}
.filter-note {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--color-sub-text);
  line-height: 1.8;
}
.compact {
  padding: 10px 14px;
  margin: 60px 0 18px;
  background: var(--color-second);
  border: 1px solid var(--color-line);
  border-radius: 9px;
}
.simple-filter-editor {
  width: min(520px, calc(100vw - 80px));
  color: var(--color-main-text);
  font-size: 13px;
}
.editor-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  cursor: pointer;
}
.editor-toggle input {
  accent-color: #756ad8;
  width: 16px;
  height: 16px;
}
.editor-description,
.separator-help {
  font-size: 12px;
  color: var(--color-sub-text);
  line-height: 1.9;
  margin: 11px 0;
}
.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 18px 0;
}
.editor-actions button {
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-second);
  padding: 7px 10px;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
.editor-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.editor-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
  font-weight: 600;
}
.editor-label span {
  font-size: 11px;
  color: var(--color-sub-text);
  font-weight: normal;
}
.simple-filter-editor textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-textarea-bg);
  color: var(--color-reverse-black);
  font:
    14px/1.8 ui-monospace,
    monospace;
}
.simple-filter-editor textarea:focus {
  outline: 2px solid #a39ae0;
  outline-offset: 2px;
}
.filter-preview {
  border: 1px solid var(--color-line);
  background: var(--color-second);
  border-radius: 8px;
  padding: 12px;
  margin-top: 16px;
}
.filter-preview strong {
  font-size: 12px;
}
.filter-preview p {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.9;
  color: var(--color-sub-text);
  overflow-wrap: anywhere;
}
@media (max-width: 768px) {
  .compact {
    margin-top: 12px;
  }
}
@media (max-width: 480px) {
  .compact {
    padding: 9px 11px;
  }
  .filter-switch {
    font-size: 12px;
  }
  .filter-switch b {
    display: none;
  }
  .manage-filter {
    font-size: 11px;
  }
}
</style>
