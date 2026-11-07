<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGrowthStore, dictionaryGrowthId } from '@/core/stores/growth'
import { useBaseStore } from '@/core/stores/base'
import { useRouter } from 'vue-router'
import '@/assets/css/growth.scss'

useHead({ title: '选择五词成长任务 · TypeWords' })
const growth = useGrowthStore()
const base = useBaseStore()
const router = useRouter()
const selected = ref<string[]>([])
const confidence = ref<number | null>(null)
const busy = ref(false)
const message = ref('')
const importInput = ref<HTMLInputElement>()
let requestId = ''
let recommended = false
const ignored = computed(() => base.getIgnoreWordsSet())
function choosePack(pack: any) {
  selected.value = pack.words.map((w: any) => w.id).filter((id: string) => !ignored.value.has(id))
}
function recommend() {
  if (recommended || !base.load || !growth.catalog.length) return
  recommended = true
  const dictionary = new Set(base.sdict.words.map(w => w.word.toLowerCase()))
  const ordered = [...growth.catalog].sort(
    (a, b) =>
      b.words.filter((w: any) => dictionary.has(w.id)).length - a.words.filter((w: any) => dictionary.has(w.id)).length
  )
  const words = ordered.flatMap(p => p.words).filter((w: any) => !ignored.value.has(w.id))
  selected.value = words.slice(0, 5).map((w: any) => w.id)
}
watch(() => [base.load, growth.catalog.length], recommend)
onMounted(async () => {
  requestId = crypto.randomUUID()
  try {
    await Promise.all([growth.load(), growth.loadCatalog()])
    recommend()
  } catch (e: any) {
    message.value = e.message
  }
})
async function create() {
  if (busy.value || selected.value.length !== 5 || selected.value.some(w => ignored.value.has(w))) return
  busy.value = true
  message.value = ''
  try {
    const data = await growth.act({
      op: 'create',
      words: selected.value,
      confidence: confidence.value,
      requestId,
      dictionaryId: dictionaryGrowthId(base.sdict),
    })
    await router.push('/growth/' + data.createdId)
  } catch (e: any) {
    message.value = e.message
  } finally {
    busy.value = false
  }
}
async function restore(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!window.confirm('恢复这份成长记录？当前记录会先自动归档，普通词典和设置保持原样。')) return
  busy.value = true
  try {
    await growth.importBackup(file)
    message.value = '成长记录已恢复。'
  } catch (e: any) {
    message.value = e.message
  } finally {
    busy.value = false
    if (importInput.value) importInput.value.value = ''
  }
}
</script>

<template>
  <main class="growth-page">
    <NuxtLink to="/words">← 返回学习页</NuxtLink>
    <h1>用 5 个词，积累 7 次成功证据</h1>
    <p class="gp-muted">同一组词，逐步验证认出、听懂、拼写和用法。累计完成，不要求连续 7 天；今天做多少都可以。</p>
    <section v-if="growth.current" class="gp-panel">
      <h2>原来的任务还在</h2>
      <p>已积累 {{ growth.current.awards.length }}/7 次成功证据。开始新组会保留旧记录。</p>
      <NuxtLink class="gp-button primary" :to="`/growth/${growth.current.id}`">继续原任务</NuxtLink>
    </section>
    <section class="gp-panel" aria-label="选择五个目标词">
      <h2>先选刚好适合的 5 个词 · {{ selected.length }}/5</h2>
      <p class="gp-muted">
        先提供 3 组已备齐素材的词，可以整组选或自行选 5
        个。推荐依据当前词典，难度由你判断；简单词和已掌握词不会默认加入。
      </p>
      <div class="gp-grid">
        <section v-for="pack in growth.catalog" :key="pack.id">
          <h3>{{ pack.name }}</h3>
          <p class="gp-muted">{{ pack.description }}</p>
          <button class="gp-button" @click="choosePack(pack)">选择这组</button>
          <label v-for="word in pack.words" :key="word.id" class="gp-word">
            <input
              type="checkbox"
              v-model="selected"
              :value="word.id"
              :disabled="ignored.has(word.id) || (selected.length >= 5 && !selected.includes(word.id))"
            />
            <span>{{ word.word }}</span
            ><small>{{ ignored.has(word.id) ? '已排除' : word.meaning }}</small>
          </label>
        </section>
      </div>
    </section>
    <section class="gp-panel" aria-label="开始前的信心评分">
      <h2>开始前，留一个自己的判断</h2>
      <p>你有多大信心学会下一组类似单词？0～10 分。</p>
      <div class="gp-scores">
        <button v-for="n in 11" :key="n" :aria-pressed="confidence === n - 1" @click="confidence = n - 1">
          {{ n - 1 }}
        </button>
      </div>
      <p class="gp-muted">0 表示完全没有信心，10 表示很有信心。可以暂不回答，不影响成功记录。</p>
      <button class="gp-link" @click="confidence = null">暂不回答{{ confidence === null ? '（已选）' : '' }}</button>
      <div class="gp-actions">
        <button class="gp-button primary" :disabled="busy || selected.length !== 5" @click="create">
          {{ busy ? '正在保存…' : '开始这 5 个词' }}</button
        ><NuxtLink class="gp-button" to="/words">今天结束</NuxtLink>
      </div>
    </section>
    <p v-if="message" class="gp-error" role="status">{{ message }}</p>
    <section class="gp-panel">
      <h2>已有的成长记录</h2>
      <p v-if="!growth.state.rounds.length" class="gp-muted">还没有成长记录，也可以从其他设备导入备份继续。</p>
      <div v-for="round in [...growth.state.rounds].reverse()" :key="round.id" class="gp-history">
        <span>{{ new Date(round.createdAt).toLocaleDateString() }} · {{ round.awards.length }}/7 次成功</span
        ><NuxtLink :to="`/growth/${round.id}`">查看与继续 →</NuxtLink>
      </div>
      <div class="gp-actions">
        <button
          class="gp-button"
          :disabled="busy"
          @click="growth.exportBackup().catch((e: any) => (message = e.message))"
        >
          导出成长记录</button
        ><button class="gp-button" :disabled="busy" @click="importInput?.click()">恢复成长备份</button
        ><input ref="importInput" type="file" accept="application/json,.json" hidden @change="restore" />
      </div>
      <p class="gp-muted">
        包含成功证据、首次作答、信心、已见试题与词典里程碑；恢复前会自动保留旧数据归档。现有服务器归档与 GitHub
        备份也包含这些记录。
      </p>
    </section>
  </main>
</template>
