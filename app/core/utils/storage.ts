import { entries as localEntries, get as localGet, set as localSet, setMany, delMany } from 'idb-keyval'
import { reactive } from 'vue'
import { withAppBaseURL } from './base-url'
import { decodeStorageValue, encodeStorageValue } from './storage-codec'

const META_KEY = '__typewords_shared_storage_v1'
const SHARED_LOCAL_KEYS = ['PracticeFlowV2', 'typewords-learning-guide-v2']
const LEGACY_CACHE_KEYS = ['PracticeSaveWord', 'PracticeSaveArticle']
type Meta = { id: string; revisions: Record<string, number>; pending: Record<string, number>; sequence: number }
type Snapshot = { id: string; initialized: boolean; revision: number; entries: Record<string, { revision: number; value: any }> }
let meta: Meta = { id: '', revisions: {}, pending: {}, sequence: 0 }
let initialization: Promise<boolean> | undefined
let localQueue: Promise<unknown> = Promise.resolve()
let uploading: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let available = false

export const storageStatus = reactive({
  phase: 'loading' as 'loading' | 'saved' | 'pending' | 'offline' | 'conflict',
  message: '',
  migratedBackup: 0,
})

class StorageConflict extends Error {}

async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(withAppBaseURL('/api/data' + path), {
    method, cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 409) throw new StorageConflict('另一浏览器已更新数据。当前变动仍保留在本机，请备份后载入服务器版本。')
  if (!response.ok) throw new Error('服务器保存失败（' + response.status + '），数据暂存于此浏览器，请重试。')
  return await response.json()
}

function report(error: unknown) {
  storageStatus.phase = error instanceof StorageConflict ? 'conflict' : 'offline'
  storageStatus.message = error instanceof Error ? error.message : '尚未保存到服务器，数据仍在当前浏览器。'
}

async function captureLocal() {
  const result: Record<string, any> = {}
  for (const [key, value] of await localEntries()) {
    if (typeof key === 'string' && key !== META_KEY) result[key] = await encodeStorageValue(value)
  }
  for (const key of SHARED_LOCAL_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) result['local:' + key] = await encodeStorageValue(value)
  }
  for (const key of LEGACY_CACHE_KEYS) {
    const value = localStorage.getItem(key)
    if (!(key in result) && value !== null) result[key] = await encodeStorageValue(value)
  }
  return result
}

async function hydrate(snapshot: Snapshot) {
  const previous = (await localEntries()).map(([key]) => key).filter(key => key !== META_KEY)
  const values: [IDBValidKey, any][] = []
  const retained = new Set<string>()
  for (const key of [...SHARED_LOCAL_KEYS, ...LEGACY_CACHE_KEYS]) localStorage.removeItem(key)
  for (const [key, row] of Object.entries(snapshot.entries)) {
    if (row.value.type === 'deleted') continue
    const value = decodeStorageValue(row.value)
    if (key.startsWith('local:')) {
      if (SHARED_LOCAL_KEYS.includes(key.slice(6))) localStorage.setItem(key.slice(6), value)
    } else {
      values.push([key, value])
      retained.add(key)
    }
  }
  await setMany(values)
  await delMany(previous.filter(key => !retained.has(String(key))))
  meta = { id: snapshot.id, revisions: Object.fromEntries(Object.entries(snapshot.entries).map(([key, row]) => [key, row.revision])), pending: {}, sequence: 0 }
  await localSet(META_KEY, meta)
}

export function initializeStorage(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return initialization ??= (async () => {
    meta = (await localGet<Meta>(META_KEY)) ?? meta
    try {
      const local = await captureLocal()
      let snapshot: Snapshot = await request('/state')
      if (!snapshot.initialized) snapshot = await request('/initialize', 'POST', { items: local })
      if (meta.id === snapshot.id && Object.keys(meta.pending).length) {
        available = true
        await uploadPending()
        if (storageStatus.phase === 'conflict' || storageStatus.phase === 'offline') return false
        snapshot = await request('/state')
      } else if (Object.keys(local).length && meta.id !== snapshot.id) {
        // Never discard the old browser's independent progress during first-time migration.
        const archive = await request('/archives', 'POST', { items: local })
        storageStatus.migratedBackup = archive.id
      }
      await hydrate(snapshot)
      available = true
      storageStatus.phase = 'saved'
      storageStatus.message = ''
      return true
    } catch (error) {
      report(error)
      return false
    }
  })()
}

async function uploadPending() {
  await localQueue
  const stamps = { ...meta.pending }
  if (!Object.keys(stamps).length) return
  const items: Record<string, any> = {}
  const all = await localEntries()
  for (const key of Object.keys(stamps)) {
    const entry = all.find(([storedKey]) => storedKey === key)
    items[key] = entry ? await encodeStorageValue(entry[1]) : { type: 'deleted' }
  }
  const revisions = Object.fromEntries(Object.keys(items).map(key => [key, meta.revisions[key] ?? 0]))
  const result = await request('/state', 'PUT', { id: meta.id, items, revisions })
  localQueue = localQueue.then(async () => {
    Object.assign(meta.revisions, result.revisions)
    for (const key of Object.keys(stamps)) {
      if (meta.pending[key] === stamps[key]) delete meta.pending[key]
    }
    await localSet(META_KEY, meta)
  })
  await localQueue
  storageStatus.phase = Object.keys(meta.pending).length ? 'pending' : 'saved'
  storageStatus.message = ''
}

export async function flushStorage() {
  if (!available || storageStatus.phase === 'conflict') return
  if (uploading) return uploading
  uploading = uploadPending().catch(report).finally(() => {
    uploading = undefined
    if (storageStatus.phase === 'pending') schedule()
  })
  return uploading
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => { void flushStorage() }, 150)
}

export async function get<T = any>(key: IDBValidKey): Promise<T | undefined> {
  await initializeStorage()
  await localQueue
  return localGet<T>(key)
}

async function write(key: IDBValidKey, updater: (current: any) => any, deleted = false) {
  await initializeStorage()
  const task = localQueue.then(async () => {
    meta.pending[String(key)] = ++meta.sequence
    if (deleted) {
      await delMany([key])
      await localSet(META_KEY, meta)
    } else {
      const value = updater(await localGet(key))
      await setMany([[key, value], [META_KEY, meta]])
    }
    if (storageStatus.phase !== 'conflict' && storageStatus.phase !== 'offline') storageStatus.phase = 'pending'
    schedule()
  })
  localQueue = task.catch(report)
  await task
}

export async function set(key: IDBValidKey, value: any) { await write(key, () => value) }
export async function del(key: IDBValidKey) { await write(key, () => undefined, true) }
export async function update(key: IDBValidKey, updater: (value: any) => any) {
  await write(key, updater)
}

export function setSharedLocalStorage(key: string, value: string) {
  localStorage.setItem(key, value)
  void set('local:' + key, value)
}

export async function reloadSharedStorage() {
  await localQueue
  // A failed or conflicting browser always gets a recoverable server-side copy before replacement.
  await request('/archives', 'POST', { items: await captureLocal() })
  const snapshot: Snapshot = await request('/state')
  await hydrate(snapshot)
  location.reload()
}

export async function downloadBrowserCopy() {
  await localQueue
  const blob = new Blob([JSON.stringify({ format: 'typewords-server-storage-v1', items: await captureLocal() })], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'TypeWords-browser-copy-' + new Date().toISOString().slice(0, 10) + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const listStorageArchives = () => request('/archives')
export const getStorageArchive = (id: number) => request('/archives/' + id)
export async function retrySharedStorage() {
  initialization = undefined
  if (await initializeStorage()) location.reload()
}
export async function restoreStorageArchive(items: Record<string, any>) {
  const snapshot: Snapshot = await request('/state')
  await request('/restore', 'POST', { revision: snapshot.revision, items })
  await hydrate(await request('/state'))
  location.reload()
}
