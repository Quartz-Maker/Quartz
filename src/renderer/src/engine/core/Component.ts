// `Component` lifecycle (plugin API): load/unload cascade to children,
// and everything registered is torn down on unload in reverse registration order.
import type { EventRef } from './Events'

export class Component {
  _loaded = false
  _events: (() => unknown)[] = []
  _children: Component[] = []

  load(): void {
    if (this._loaded) return
    this._loaded = true
    this.onload()
    for (const child of this._children.slice()) child.load()
  }

  onload(): void {}

  unload(): void {
    if (!this._loaded) return
    this._loaded = false
    while (this._children.length) this._children.pop()!.unload()
    while (this._events.length) {
      try {
        this._events.pop()!()
      } catch (e) {
        console.error(e)
      }
    }
    this.onunload()
  }

  onunload(): void {}

  addChild<T extends Component>(component: T): T {
    this._children.push(component)
    if (this._loaded) component.load()
    return component
  }

  removeChild<T extends Component>(component: T): T {
    const i = this._children.indexOf(component)
    if (i !== -1) {
      this._children.splice(i, 1)
      component.unload()
    }
    return component
  }

  register(cb: () => unknown): void {
    this._events.push(cb)
  }

  registerEvent(ref: EventRef): void {
    this.register(() => ref.e.offref(ref))
  }

  registerDomEvent(el: Window | Document | HTMLElement, type: string, callback: (this: HTMLElement, ev: any) => any, options?: boolean | AddEventListenerOptions): void {
    el.addEventListener(type, callback as EventListener, options)
    this.register(() => el.removeEventListener(type, callback as EventListener, options))
  }

  registerScopeEvent(keyHandler: { scope: { unregister(h: unknown): void } }): void {
    this.register(() => keyHandler.scope.unregister(keyHandler))
  }

  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id))
    return id
  }
}
