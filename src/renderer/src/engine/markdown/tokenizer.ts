/* eslint-disable @typescript-eslint/no-explicit-any */
// Tokenizer factory derived from remark-parse@8.0.3 `lib/tokenizer.js` (MIT, (c) Titus Wormer).
// This copy differs in one observable way: the parser leaves its "at start" state as
// soon as *any* non-empty value is eaten (so a leading blank line disables frontmatter),
// and `eat(...).reset()` restores that state.

function mergeable(node: any): boolean {
  if (node.type !== 'text' || !node.position) return true
  const start = node.position.start
  const end = node.position.end
  return start.line !== end.line || end.column - start.column === node.value.length
}
function mergeText(previous: any, node: any): any {
  previous.value += node.value
  return previous
}
function mergeBlockquote(this: any, previous: any, node: any): any {
  if (this.options.commonmark || this.options.gfm) return node
  previous.children = previous.children.concat(node.children)
  return previous
}

export function tokenizerFactory(type: 'block' | 'inline'): any {
  return function tokenize(this: any, value: string, location: any): any[] {
    const self = this
    const offset = self.offset
    const tokens: any[] = []
    const methods = self[type + 'Methods']
    const tokenizers = self[type + 'Tokenizers']
    let line = location.line
    let column = location.column
    if (!value) return tokens
    ;(eat as any).now = now
    ;(eat as any).file = self.file
    updatePosition('')
    while (value) {
      let index = -1
      const length = methods.length
      let matched = false
      while (++index < length) {
        const method = tokenizers[methods[index]]
        if (
          method &&
          (!method.onlyAtStart || self.atStart) &&
          (!method.notInList || !self.inList) &&
          (!method.notInBlock || !self.inBlock) &&
          (!method.notInLink || !self.inLink)
        ) {
          const valueLength = value.length
          method.apply(self, [eat, value])
          matched = valueLength !== value.length
          if (matched) break
        }
      }
      if (!matched) self.file.fail(new Error('Infinite loop'), now())
    }
    self.eof = now()
    return tokens

    function updatePosition(subvalue: string): void {
      let lastIndex = -1
      let index = subvalue.indexOf('\n')
      while (index !== -1) {
        line++
        lastIndex = index
        index = subvalue.indexOf('\n', index + 1)
      }
      if (lastIndex === -1) column += subvalue.length
      else column = subvalue.length - lastIndex
      if (line in offset) {
        if (lastIndex !== -1) column += offset[line]
        else if (column <= offset[line]) column = offset[line] + 1
      }
    }
    function getOffset(): () => number[] {
      const indentation: number[] = []
      let pos = line + 1
      return function () {
        const last = line + 1
        while (pos < last) {
          indentation.push((offset[pos] || 0) + 1)
          pos++
        }
        return indentation
      }
    }
    function now(): any {
      const pos: any = { line, column }
      pos.offset = self.toOffset(pos)
      return pos
    }
    function Position(this: any, start: any): void {
      this.start = start
      this.end = now()
    }
    function validateEat(subvalue: string): void {
      if (value.slice(0, subvalue.length) !== subvalue) {
        self.file.fail(new Error('Incorrectly eaten value: please report this warning on https://git.io/vg5Ft'), now())
      }
    }
    function position(): (node: any, indent?: any) => any {
      const before = now()
      return function update(node: any, indent?: any) {
        const previous = node.position
        const start = previous ? previous.start : before
        let combined: number[] = []
        let n = previous && previous.end.line
        const l = before.line
        node.position = new (Position as any)(start)
        if (previous && indent && previous.indent) {
          combined = previous.indent
          if (n < l) {
            while (++n < l) combined.push((offset[n] || 0) + 1)
            combined.push(before.column)
          }
          indent = combined.concat(indent)
        }
        node.position.indent = indent || []
        return node
      }
    }
    function add(node: any, parent?: any): any {
      const children = parent ? parent.children : tokens
      const previous = children[children.length - 1]
      if (
        previous &&
        node.type === previous.type &&
        (node.type === 'text' || node.type === 'blockquote') &&
        mergeable(previous) &&
        mergeable(node)
      ) {
        node = (node.type === 'text' ? mergeText : mergeBlockquote).call(self, previous, node)
      }
      if (node !== previous) children.push(node)
      return node
    }
    function eat(subvalue: string): any {
      let indent: any = getOffset()
      const pos = position()
      const current = now()
      validateEat(subvalue)
      ;(apply as any).reset = reset
      ;(reset as any).test = test
      ;(apply as any).test = test
      value = value.slice(subvalue.length)
      updatePosition(subvalue)
      const wasAtStart = self.atStart
      if (self.atStart && subvalue.length !== 0) self.exitStart()
      indent = indent()
      return apply
      function apply(node: any, parent?: any): any {
        return pos(add(pos(node), parent), indent)
      }
      function reset(...args: any[]): any {
        const node = (apply as any)(...args)
        line = current.line
        column = current.column
        value = subvalue + value
        self.atStart = wasAtStart
        return node
      }
      function test(): any {
        const result = pos({})
        line = current.line
        column = current.column
        value = subvalue + value
        return result.position
      }
    }
  }
}
