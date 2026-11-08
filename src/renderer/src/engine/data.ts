// Public entry for the data core (plugin-API names).
export { App, createApp, getApp, setCurrentApp, setGlobalApp, vaultIdForPath } from './App'
export { Vault } from './vault/Vault'
export { FileSystemAdapter } from './vault/FileSystemAdapter'
export type { Stat, ListedFiles, DataWriteOptions } from './vault/FileSystemAdapter'
export { TAbstractFile, TFile, TFolder } from './vault/TAbstractFile'
export type { FileStats } from './vault/TAbstractFile'
export { normalizePath } from './vault/path'
export { debounce } from './vault/debounce'
export { CONFIG_DEFAULTS, APPEARANCE_KEYS, DEFAULT_CONFIG_DIR } from './vault/config'
export { MetadataCache } from './metadata/MetadataCache'
export { FileManager } from './FileManager'
export { computeMetadata } from './metadata/parser/computeMetadata'
export { parseMarkdown } from './metadata/parser/quartzParser'
export { getLinkpath, parseLinktext, stripHeading, stripHeadingForLink } from './metadata/linktext'
export {
  getAllTags, iterateCacheRefs, iterateRefs, parseFrontMatterAliases, parseFrontMatterEntry,
  parseFrontMatterStringArray, parseFrontMatterTags
} from './metadata/helpers'
export { getFrontMatterInfo } from './metadata/linkUpdate'
