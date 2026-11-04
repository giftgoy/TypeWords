// Keep unfinished sessions visible without writing them into settled statistics.
export function pendingStudyRows(stat: any, dictName: string) {
  if (!stat?.spend) return []
  const days = new Map<string, { startDate: number; spend: number }>()
  for (const [start, end] of stat.segments?.length ? stat.segments : [[stat.startDate, stat.startDate + stat.spend]]) {
    const key = new Date(start).toLocaleDateString()
    const day = days.get(key) || { startDate: start, spend: 0 }
    day.spend += end - start
    days.set(key, day)
  }
  return [...days.values()].map((day, index, list) => ({
    ...day, dictName, pending: true,
    total: 0, new: 0, review: 0,
    // An unfinished task has no settled word count yet. Errors belong to the session's final day.
    wrong: index === list.length - 1 ? stat.wrong || 0 : 0,
  }))
}
