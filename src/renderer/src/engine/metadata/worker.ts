// "Metadata Cache Worker": receives a file's bytes, answers with CachedMetadata
// (protocol: { metadataCache: ArrayBuffer } → CachedMetadata | null).
import { computeMetadata } from './parser/computeMetadata'

self.onmessage = (e: MessageEvent) => {
  try {
    const data = e.data
    if (data && Object.prototype.hasOwnProperty.call(data, 'metadataCache')) {
      const buf: ArrayBuffer | null = data.metadataCache
      if (!buf) return self.postMessage({})
      return self.postMessage(computeMetadata(new TextDecoder().decode(buf)))
    }
  } catch (err) {
    console.error('AppWorker exception', err)
  }
  self.postMessage(null)
}
