export interface ReadingSegment { text: string; paragraph: number; start?: number; end?: number }

export function readingSegments(sections: { text: string; audioPosition?: number[] }[][]): ReadingSegment[] {
  return sections.flatMap((section, paragraph) => section.flatMap(sentence => {
    const [start, end] = sentence.audioPosition || []
    if (Number.isFinite(start) && end > start) return [{ text: sentence.text, paragraph, start, end }]
    // Keep long imported paragraphs below the speech service's request limit.
    return (sentence.text.match(/[^.!?]+[.!?]*\s*/g) || [sentence.text]).flatMap(text => {
      const words = text.trim().split(/\s+/)
      const chunks: ReadingSegment[] = []
      for (let i = 0; i < words.length; i += 60) chunks.push({ text: words.slice(i, i + 60).join(' '), paragraph })
      return chunks
    })
  })).filter(s => s.text.trim())
}
