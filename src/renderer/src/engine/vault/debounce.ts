// obsidian.d.ts `debounce(cb, timeout, resetTimer)` → Debouncer with cancel()/run().
export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>
  cancel(): Debouncer<T, V>
  run(): V | void
}

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let args: T | null = null
  let ctx: unknown = null
  let deadline = 0
  const call = (): V => {
    const a = args!
    const c = ctx
    args = null
    ctx = null
    return cb.apply(c, a)
  }
  const fire = (): void => {
    if (deadline) {
      const now = Date.now()
      if (now < deadline) {
        timer = setTimeout(fire, deadline - now)
        deadline = 0
        return
      }
    }
    timer = null
    call()
  }
  const d = function (this: unknown, ...a: T) {
    ctx = this
    args = a
    if (timer) {
      if (resetTimer) deadline = Date.now() + timeout
    } else {
      timer = setTimeout(fire, timeout)
    }
    return d
  } as Debouncer<T, V>
  d.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    return d
  }
  d.run = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      return call()
    }
  }
  return d
}
