// Type declarations for the vendored JavaScript (CodeMirror 5 modes / HyperMD).
declare module '*/hypermd/tokenize.js' {
  export function tokenizeDocument(text: string, opts?: { tabSize?: number; indentUnit?: number }): Array<Array<[string, string | null]>>
  export function getHyperMDMode(): import('./streamLanguage').LegacyMode
}
declare module '*/hypermd/registry.js' {
  export function getModeRegistry(): any
}
declare module '*/hypermd/normalize.js' {
  export function splitStyle(style: string): [string, string[]]
  export function normalizeLine(tokens: Array<[string, string | null]>): { line: string; spans: Array<[number, number, string]> }
}
declare module '*/hypermd/stream.js' {
  export class StringStream {
    constructor(string: string, tabSize: number, indentUnit: number, lookAhead?: (n: number) => string, overrideIndent?: number)
    string: string; pos: number; start: number; tabSize: number; indentUnit: number; lineStart: number
    lookAhead: (n: number) => string
    eol(): boolean; sol(): boolean; peek(): string | undefined; next(): string | undefined
    eat(match: string | RegExp | ((ch: string) => boolean)): string | undefined
    eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean
    eatSpace(): boolean; skipToEnd(): void; skipTo(ch: string): boolean | undefined; backUp(n: number): void
    column(): number; indentation(): number
    match(pattern: string | RegExp, consume?: boolean, caseInsensitive?: boolean): any
    current(): string
  }
  export function readToken(token: (stream: StringStream, state: any) => any, stream: StringStream, state: any): any
}
