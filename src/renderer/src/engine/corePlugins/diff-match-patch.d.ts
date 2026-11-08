// diff-match-patch 1.0.5 (Apache-2.0) ships no types; only what the file-recovery diff uses.
declare module 'diff-match-patch' {
  export type Diff = [number, string]
  export default class diff_match_patch {
    Diff_Timeout: number
    diff_main(a: string, b: string, checklines?: boolean): Diff[]
    diff_cleanupSemantic(diffs: Diff[]): void
    diff_levenshtein(diffs: Diff[]): number
    diff_linesToChars_(a: string, b: string): { chars1: string; chars2: string; lineArray: string[] }
    diff_charsToLines_(diffs: Diff[], lineArray: string[]): void
  }
  export const DIFF_DELETE: -1
  export const DIFF_INSERT: 1
  export const DIFF_EQUAL: 0
}
