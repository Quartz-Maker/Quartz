export class StringStream {
  constructor(string: string, tabSize: number, indentUnit: number, lookAhead?: (n: number) => string, overrideIndent?: number)
  string: string
  pos: number
  start: number
  tabSize: number
  indentUnit: number
  lineStart: number
  lookAhead: (n: number) => string
  eol(): boolean
  sol(): boolean
  peek(): string | undefined
  next(): string | undefined
  eat(match: string | RegExp | ((ch: string) => boolean)): string | undefined
  eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean
  eatSpace(): boolean
  skipToEnd(): void
  skipTo(ch: string): boolean | undefined
  backUp(n: number): void
  column(): number
  indentation(): number
  match(pattern: string | RegExp, consume?: boolean, caseInsensitive?: boolean): any
  current(): string
}
export function readToken(token: (stream: StringStream, state: any) => any, stream: StringStream, state: any): any
