export async function encodeStorageValue(value: any): Promise<any> {
  if (value === undefined) return { type: 'undefined' }
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 16384) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 16384))
    }
    return { type: 'blob', mime: value.type, value: btoa(binary) }
  }
  if (value instanceof Date) return { type: 'date', value: value.toISOString() }
  if (Array.isArray(value)) return { type: 'array', value: await Promise.all(value.map(encodeStorageValue)) }
  if (value !== null && typeof value === 'object') {
    return { type: 'object', value: Object.fromEntries(await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await encodeStorageValue(item)])
    )) }
  }
  return { type: 'value', value }
}

export function decodeStorageValue(encoded: any): any {
  switch (encoded.type) {
    case 'undefined': return undefined
    case 'value': return encoded.value
    case 'date': return new Date(encoded.value)
    case 'blob': return new Blob([Uint8Array.from(atob(encoded.value), char => char.charCodeAt(0))], { type: encoded.mime })
    case 'array': return encoded.value.map(decodeStorageValue)
    case 'object': return Object.fromEntries(Object.entries(encoded.value).map(([key, value]) => [key, decodeStorageValue(value)]))
    default: throw new Error('无法识别服务器存储格式')
  }
}
