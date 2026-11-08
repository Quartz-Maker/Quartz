// Lazy library handle: `then(fn)` runs `fn` synchronously
// once the library is loaded (so post-processors that follow observe its DOM changes),
// otherwise after loading.
export interface LazyLib<T> {
  readonly loaded: boolean
  readonly value: T | undefined
  readonly promise: Promise<T>
  then<R>(fn: (v: T) => R): Promise<R>
}

export function lazyLib<T>(load: () => Promise<T>): LazyLib<T> {
  let loaded = false
  let value: T | undefined
  let p: Promise<T> | null = null
  return {
    get loaded() {
      return loaded
    },
    get value() {
      return value
    },
    get promise() {
      if (loaded) return Promise.resolve(value as T)
      if (!p) {
        p = load().then(
          (v) => {
            value = v
            loaded = true
            return v
          },
          (e) => {
            p = null
            throw e
          }
        )
      }
      return p
    },
    then<R>(fn: (v: T) => R): Promise<R> {
      if (loaded) return Promise.resolve(fn(value as T))
      return this.promise.then(fn)
    }
  }
}
