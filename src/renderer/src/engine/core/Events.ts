// `Events` / `EventRef` (plugin API). A handler that throws is
// isolated: the error is logged and the remaining handlers still run.

export interface EventRef {
  e: Events
  name: string
  fn: (...data: unknown[]) => unknown
  ctx?: unknown
}

export class Events {
  private _: Record<string, EventRef[]> = {}

  on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
    const ref: EventRef = { e: this, name, fn: callback, ctx }
    ;(this._[name] ||= []).push(ref)
    return ref
  }

  off(name: string, callback: (...data: any[]) => unknown): void {
    const list = this._[name]
    if (!list) return
    const kept = list.filter(r => r.fn !== callback)
    if (kept.length) this._[name] = kept
    else delete this._[name]
  }

  offref(ref: EventRef): void {
    const list = this._[ref.name]
    if (!list) return
    const kept = list.filter(r => r !== ref)
    if (kept.length) this._[ref.name] = kept
    else delete this._[ref.name]
  }

  trigger(name: string, ...data: unknown[]): void {
    const list = this._[name]
    if (!list) return
    for (const ref of list.slice()) this.tryTrigger(ref, data)
  }

  tryTrigger(evt: EventRef, args: unknown[]): void {
    try {
      evt.fn.apply(evt.ctx, args)
    } catch (e) {
      console.error(e)
    }
  }
}
