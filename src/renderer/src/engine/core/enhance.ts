// Global DOM / builtin helpers installed before app start that plugins and themes
// rely on (declared under `declare global` in the plugin API typings).
/* eslint-disable @typescript-eslint/no-explicit-any */

type Info = DomElementInfo | string | undefined

function def(target: any, name: string, value: any): void {
  if (Object.prototype.hasOwnProperty.call(target, name)) return
  Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: false })
}

function getter(target: any, name: string, get: () => any): void {
  if (Object.prototype.hasOwnProperty.call(target, name)) return
  Object.defineProperty(target, name, { get, configurable: true, enumerable: false })
}

export function installEnhancements(win: Window & typeof globalThis = window): void {
  const w = win as any
  if (w.__quartzEnhanced) return
  w.__quartzEnhanced = true
  const { Node, Element, HTMLElement, SVGElement, DocumentFragment, Document, UIEvent } = w

  // --- Object / Array / Math / String / Number ---
  def(Object, 'isEmpty', (obj: Record<string, any>) => {
    for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) return false
    return true
  })
  def(Object, 'each', (obj: Record<string, any>, cb: (v: any, k: string) => any, ctx?: any) => {
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && cb.call(ctx, obj[k], k) === false) return false
    }
    return true
  })
  def(Array, 'combine', (arrays: any[][]) => ([] as any[]).concat(...arrays))
  const AP = Array.prototype as any
  def(AP, 'first', function (this: any[]) { return this[0] })
  def(AP, 'last', function (this: any[]) { return this[this.length - 1] })
  def(AP, 'contains', function (this: any[], t: any) { return this.indexOf(t) !== -1 })
  def(AP, 'remove', function (this: any[], t: any) {
    for (let i = this.length - 1; i >= 0; i--) if (this[i] === t) this.splice(i, 1)
  })
  def(AP, 'shuffle', function (this: any[]) {
    for (let i = this.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]]
    }
    return this
  })
  def(AP, 'unique', function (this: any[]) { return Array.from(new Set(this)) })
  def(AP, 'findLastIndex', function (this: any[], pred: (v: any) => boolean) {
    for (let i = this.length - 1; i >= 0; i--) if (pred(this[i])) return i
    return -1
  })
  def(Math, 'clamp', (v: number, min: number, max: number) => Math.min(Math.max(v, min), max))
  def(Math, 'square', (v: number) => v * v)
  def(String, 'isString', (o: any) => typeof o === 'string')
  def(String.prototype, 'contains', function (this: string, t: string) { return this.indexOf(t) !== -1 })
  def(Number, 'isNumber', (o: any) => typeof o === 'number')
  def(w, 'isBoolean', (o: any) => typeof o === 'boolean')
  // Override endsWith with our own (length-aware) version and adds format().
  Object.defineProperty(String.prototype, 'format', {
    value: function (this: string, ...args: string[]) {
      return this.replace(/{(\d+)}/g, (m, n) => (args[n] !== undefined ? args[n] : m))
    },
    configurable: true, writable: true, enumerable: false
  })

  // --- Node ---
  const NP = Node.prototype
  def(NP, 'detach', function (this: Node) { this.parentNode?.removeChild(this) })
  def(NP, 'empty', function (this: Node) { while (this.lastChild) this.removeChild(this.lastChild) })
  def(NP, 'insertAfter', function (this: Node, node: Node, child: Node | null) {
    return child ? this.insertBefore(node, child.nextSibling) : this.insertBefore(node, this.firstChild)
  })
  def(NP, 'indexOf', function (this: Node, other: Node) {
    return Array.prototype.indexOf.call(this.childNodes, other)
  })
  def(NP, 'setChildrenInPlace', function (this: Node, children: Node[]) {
    let cur = this.firstChild
    const keep = new Set(children)
    for (const child of children) {
      while (cur && !keep.has(cur)) {
        const next = cur.nextSibling
        this.removeChild(cur)
        cur = next
      }
      if (child !== cur) this.insertBefore(child, cur)
      else cur = cur!.nextSibling
    }
    while (cur) {
      const next = cur.nextSibling
      this.removeChild(cur)
      cur = next
    }
  })
  def(NP, 'appendText', function (this: Node, val: string) { this.appendChild(document.createTextNode(val)) })
  def(NP, 'instanceOf', function (this: any, type: any) {
    if (this instanceof type) return true
    let ctor = this.win?.[type.name]
    if (ctor && this instanceof ctor) return true
    ctor = this.constructorWin?.[type.name]
    return !!(ctor && this instanceof ctor)
  })
  getter(NP, 'doc', function (this: Node) { return this.ownerDocument || document })
  getter(NP, 'win', function (this: any) { return this.doc.defaultView || window })
  def(NP, 'constructorWin', win)

  // --- Element ---
  const EP = Element.prototype
  def(EP, 'getText', function (this: Element) { return this.textContent || '' })
  def(EP, 'setText', function (this: any, val: string | DocumentFragment | Node) {
    if (val instanceof DocumentFragment || val instanceof Node) {
      this.empty()
      this.appendChild(val)
      return
    }
    this.textContent = typeof val === 'string' ? val : String(val)
  })
  def(EP, 'addClass', function (this: Element, ...cls: string[]) { this.classList.add(...cls.filter(Boolean)) })
  def(EP, 'addClasses', function (this: Element, cls: string[]) { this.classList.add(...cls.filter(Boolean)) })
  def(EP, 'removeClass', function (this: Element, ...cls: string[]) { this.classList.remove(...cls) })
  def(EP, 'removeClasses', function (this: Element, cls: string[]) { this.classList.remove(...cls) })
  def(EP, 'toggleClass', function (this: Element, cls: string | string[], value: boolean) {
    for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, !!value)
  })
  def(EP, 'hasClass', function (this: Element, cls: string) { return this.classList.contains(cls) })
  def(EP, 'setAttr', function (this: Element, name: string, value: any) {
    if (value === null) this.removeAttribute(name)
    else this.setAttribute(name, String(value))
  })
  def(EP, 'setAttrs', function (this: any, obj: Record<string, any>) {
    for (const k in obj) this.setAttr(k, obj[k])
  })
  def(EP, 'getAttr', function (this: Element, name: string) { return this.getAttribute(name) })
  def(EP, 'matchParent', function (this: Element, selector: string, lastParent?: Element) {
    let el: Element | null = this
    while (el) {
      if (el.matches(selector)) return el
      if (el === lastParent) break
      el = el.parentElement
    }
    return null
  })
  def(EP, 'getCssPropertyValue', function (this: Element, prop: string, pseudo?: string) {
    return getComputedStyle(this, pseudo).getPropertyValue(prop).trim()
  })
  def(EP, 'isActiveElement', function (this: any) { return this.doc.activeElement === this })
  def(EP, 'find', function (this: Element, s: string) { return this.querySelector(s) })
  def(EP, 'findAll', function (this: Element, s: string) { return Array.prototype.slice.call(this.querySelectorAll(s)) })
  def(EP, 'findAllSelf', function (this: Element, s: string) {
    const list = Array.prototype.slice.call(this.querySelectorAll(s))
    if (this.matches(s)) list.unshift(this)
    return list
  })
  def(DocumentFragment.prototype, 'find', function (this: DocumentFragment, s: string) { return this.querySelector(s) })
  def(DocumentFragment.prototype, 'findAll', function (this: DocumentFragment, s: string) {
    return Array.prototype.slice.call(this.querySelectorAll(s))
  })

  // --- HTMLElement visibility & style ---
  const HP = HTMLElement.prototype
  def(HP, 'show', function (this: HTMLElement) {
    if (this.style.display === 'none') {
      this.style.display = this.getAttribute('data-display') || ''
      this.removeAttribute('data-display')
    }
  })
  def(HP, 'hide', function (this: HTMLElement) {
    const d = this.style.display
    if (d !== 'none') {
      this.style.display = 'none'
      if (d) this.setAttribute('data-display', d)
      else this.removeAttribute('data-display')
    }
  })
  def(HP, 'toggle', function (this: any, show: boolean) { show ? this.show() : this.hide() })
  def(HP, 'toggleVisibility', function (this: HTMLElement, visible: boolean) {
    this.style.visibility = visible ? '' : 'hidden'
  })
  def(HP, 'isShown', function (this: HTMLElement) { return !!this.offsetParent })
  const setCssStyles = function (this: HTMLElement, styles: Record<string, any>) {
    Object.assign(this.style, styles)
  }
  const setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const k in props) this.style.setProperty(k, props[k])
  }
  def(HP, 'setCssStyles', setCssStyles)
  def(SVGElement.prototype, 'setCssStyles', setCssStyles)
  def(HP, 'setCssProps', setCssProps)
  def(SVGElement.prototype, 'setCssProps', setCssProps)
  getter(HP, 'innerWidth', function (this: HTMLElement) {
    const cs = getComputedStyle(this)
    return this.scrollWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
  })
  getter(HP, 'innerHeight', function (this: HTMLElement) {
    const cs = getComputedStyle(this)
    return this.scrollHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
  })
  def(HP, 'addEventListeners', function (this: HTMLElement, map: Record<string, any>) {
    for (const k in map) if (typeof map[k] === 'function') this.addEventListener(k, map[k])
  })

  // --- element creation ---
  const createEl = (tag: string, o?: Info, cb?: (el: any) => void): any => {
    const el = document.createElement(tag)
    applyInfo(el, o)
    cb?.(el)
    return el
  }
  const applyInfo = (el: any, o: Info): void => {
    const info: DomElementInfo = typeof o === 'string' ? { cls: o } : o || {}
    if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls
    if (info.text) el.setText(info.text)
    if (info.attr) el.setAttrs(info.attr)
    if (info.title !== undefined) el.title = info.title
    if (info.value !== undefined && ('value' in el)) el.value = info.value
    if (info.type) el.type = info.type
    if (info.placeholder) el.placeholder = info.placeholder
    if (info.href) el.href = info.href
    if (info.parent) {
      if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild)
      else info.parent.appendChild(el)
    }
  }
  const createSvg = (tag: string, o?: SvgElementInfo | string, cb?: (el: any) => void): any => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as any
    const info: SvgElementInfo = typeof o === 'string' ? { cls: o } : o || {}
    if (info.cls) el.setAttribute('class', Array.isArray(info.cls) ? info.cls.join(' ') : info.cls)
    if (info.attr) el.setAttrs(info.attr)
    if (info.parent) {
      if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild)
      else info.parent.appendChild(el)
    }
    cb?.(el)
    return el
  }
  w.createEl = createEl
  w.createDiv = (o?: Info, cb?: any) => createEl('div', o, cb)
  w.createSpan = (o?: Info, cb?: any) => createEl('span', o, cb)
  w.createSvg = createSvg
  w.createFragment = (cb?: (el: DocumentFragment) => void) => {
    const f = document.createDocumentFragment()
    cb?.(f)
    return f
  }
  const withParent = (self: Node, o: any): any => {
    const info = typeof o === 'string' ? { cls: o } : { ...(o || {}) }
    info.parent = self
    return info
  }
  def(NP, 'createEl', function (this: Node, tag: string, o?: Info, cb?: any) { return createEl(tag, withParent(this, o), cb) })
  def(NP, 'createDiv', function (this: Node, o?: Info, cb?: any) { return createEl('div', withParent(this, o), cb) })
  def(NP, 'createSpan', function (this: Node, o?: Info, cb?: any) { return createEl('span', withParent(this, o), cb) })
  def(NP, 'createSvg', function (this: Node, tag: string, o?: any, cb?: any) { return createSvg(tag, withParent(this, o), cb) })

  w.fish = (s: string) => document.querySelector(s)
  w.fishAll = (s: string) => Array.prototype.slice.call(document.querySelectorAll(s))

  // --- delegated events ---
  const on = function (this: any, type: string, selector: string, listener: Function, options?: any) {
    const events = (this._EVENTS ||= {})
    const list = (events[type] ||= [])
    const callback = function (this: any, ev: Event) {
      const target = ev.target as any
      if (target?.matchParent) {
        const match = target.matchParent(selector, ev.currentTarget)
        if (match) listener.call(this, ev, match)
      }
    }
    list.push({ selector, listener, options, callback })
    this.addEventListener(type, callback, options)
  }
  const off = function (this: any, type: string, selector: string, listener: Function, options?: any) {
    const list: any[] | undefined = this._EVENTS?.[type]
    if (!list) return
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]
      if (e.selector === selector && e.listener === listener && e.options === options) {
        this.removeEventListener(type, e.callback, options)
        list.splice(i, 1)
      }
    }
  }
  def(HP, 'on', on)
  def(HP, 'off', off)
  def(Document.prototype, 'on', on)
  def(Document.prototype, 'off', off)
  def(HP, 'onClickEvent', function (this: HTMLElement, listener: any, options?: any) {
    this.addEventListener('click', listener, options)
    this.addEventListener('auxclick', listener, options)
  })
  def(HP, 'trigger', function (this: HTMLElement, type: string) {
    this.dispatchEvent(new Event(type, { bubbles: true, cancelable: false }))
  })
  // Detect insertion via a CSS animation named "node-inserted" on .node-insert-event.
  const insertCounts = new WeakMap<HTMLElement, number>()
  def(HP, 'onNodeInserted', function (this: any, listener: () => any, once?: boolean) {
    const remove = () => {
      this.removeEventListener('animationstart', handler)
      const n = (insertCounts.get(this) || 0) - 1
      if (n <= 0) {
        insertCounts.delete(this)
        this.removeClass('node-insert-event')
      } else insertCounts.set(this, n)
    }
    const handler = (ev: AnimationEvent) => {
      if (this.isShown() && ev.animationName === 'node-inserted' && ev.target === this) {
        if (once) remove()
        listener()
      }
    }
    insertCounts.set(this, (insertCounts.get(this) || 0) + 1)
    this.addClass('node-insert-event')
    this.addEventListener('animationstart', handler)
    return remove
  })
  def(HP, 'onWindowMigrated', function (this: any, listener: (win: Window) => any) {
    return this.onNodeInserted(() => {
      if (this.win !== this.constructorWin) listener(this.win)
    })
  })

  getter(UIEvent.prototype, 'targetNode', function (this: Event) { return this.target as Node | null })
  getter(UIEvent.prototype, 'win', function (this: any) { return this.view || window })
  getter(UIEvent.prototype, 'doc', function (this: any) { return this.win.document })
  def(UIEvent.prototype, 'instanceOf', function (this: any, type: any) {
    if (this instanceof type) return true
    const ctor = this.win?.[type.name]
    return !!(ctor && this instanceof ctor)
  })

  // --- async / ajax helpers ---
  w.sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
  w.nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
  w.ready = (fn: () => any) => {
    if (document.readyState !== 'loading') fn()
    else document.addEventListener('DOMContentLoaded', fn)
  }
  w.activeWindow = win
  w.activeDocument = win.document
  w.ajax = (opts: AjaxOptions) => {
    const req = opts.req || new XMLHttpRequest()
    req.open(opts.method || 'GET', opts.url, true)
    req.withCredentials = !!opts.withCredentials
    for (const k in opts.headers || {}) req.setRequestHeader(k, opts.headers![k])
    req.onload = () => {
      if (req.status >= 200 && req.status < 400) {
        let res: any = req.responseText
        try { res = JSON.parse(res) } catch { /* plain text */ }
        opts.success?.(res, req)
      } else opts.error?.(req.statusText, req)
    }
    req.onerror = () => opts.error?.(req.statusText, req)
    let data: any = opts.data
    if (data && typeof data === 'object' && !(data instanceof ArrayBuffer)) {
      data = JSON.stringify(data)
      if (!opts.headers?.['Content-Type']) req.setRequestHeader('Content-Type', 'application/json; charset=utf-8')
    }
    req.send(data)
  }
  w.ajaxPromise = (opts: AjaxOptions) => new Promise((resolve, reject) => {
    w.ajax({ ...opts, success: resolve, error: reject })
  })
}
