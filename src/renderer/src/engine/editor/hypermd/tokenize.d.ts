import type { LegacyMode } from './streamLanguage'
export function tokenizeDocument(text: string, opts?: { tabSize?: number; indentUnit?: number }): Array<Array<[string, string | null]>>
export function getHyperMDMode(): LegacyMode
