// Global search result sort orders (search view dropdown).
import type { TFile } from 'obsidian'

export type SearchSortOrder =
  | 'alphabetical' | 'alphabeticalReverse'
  | 'byModifiedTime' | 'byModifiedTimeReverse'
  | 'byCreatedTime' | 'byCreatedTimeReverse'

/** Dropdown groups, in display order. */
export const SORT_ORDER_GROUPS: SearchSortOrder[][] = [
  ['alphabetical', 'alphabeticalReverse'],
  ['byModifiedTime', 'byModifiedTimeReverse'],
  ['byCreatedTime', 'byCreatedTimeReverse']
]

export const SORT_ORDER_LABELS: Record<SearchSortOrder, string> = {
  alphabetical: 'File name (A to Z)',
  alphabeticalReverse: 'File name (Z to A)',
  byModifiedTime: 'Modified time (new to old)',
  byModifiedTimeReverse: 'Modified time (old to new)',
  byCreatedTime: 'Created time (new to old)',
  byCreatedTimeReverse: 'Created time (old to new)'
}

const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true })

type FileLike = Pick<TFile, 'basename' | 'stat'>

export const SORT_COMPARATORS: Record<SearchSortOrder, (a: FileLike, b: FileLike) => number> = {
  alphabetical: (a, b) => collator.compare(a.basename, b.basename),
  alphabeticalReverse: (a, b) => -collator.compare(a.basename, b.basename),
  byModifiedTime: (a, b) => b.stat.mtime - a.stat.mtime,
  byModifiedTimeReverse: (a, b) => -(b.stat.mtime - a.stat.mtime),
  byCreatedTime: (a, b) => b.stat.ctime - a.stat.ctime,
  byCreatedTimeReverse: (a, b) => -(b.stat.ctime - a.stat.ctime)
}

export function isSortOrder(s: unknown): s is SearchSortOrder {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(SORT_COMPARATORS, s)
}

/** Comparator for `order`, falling back to `alphabetical`. */
export function getSortComparator(order: string): (a: FileLike, b: FileLike) => number {
  return SORT_COMPARATORS[isSortOrder(order) ? order : 'alphabetical']
}
