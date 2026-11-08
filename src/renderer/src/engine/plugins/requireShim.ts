/* eslint-disable @typescript-eslint/no-explicit-any */
// The `require` handed to plugin code (see `loadPlugin`): `obsidian` and the
// CM6/Lezer packages resolve to Quartz's OWN bundled instances (the same ones the editor uses, so
// extensions interoperate); deprecated CM5-era names map to their replacement with a console
// error; everything else falls through to Node's `window.require`.
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import * as cmCommands from '@codemirror/commands'
import * as cmSearch from '@codemirror/search'
import * as cmAutocomplete from '@codemirror/autocomplete'
import * as cmLint from '@codemirror/lint'
import * as lezerCommon from '@lezer/common'
import * as lezerHighlight from '@lezer/highlight'
import * as lezerLr from '@lezer/lr'

/** `@codemirror/collab` is not bundled with Quartz (collaborative editing); an empty module. */
const cmCollab = {}

export function getKnownModules(apiModule: any): Record<string, any> {
  return {
    obsidian: apiModule,
    '@codemirror/autocomplete': cmAutocomplete,
    '@codemirror/collab': cmCollab,
    '@codemirror/commands': cmCommands,
    '@codemirror/language': cmLanguage,
    '@codemirror/lint': cmLint,
    '@codemirror/search': cmSearch,
    '@codemirror/state': cmState,
    '@codemirror/text': cmState,
    '@codemirror/view': cmView,
    '@lezer/common': lezerCommon,
    '@lezer/lr': lezerLr,
    '@lezer/highlight': lezerHighlight
  }
}

export const DEPRECATED_MODULES: Record<string, any> = {
  '@codemirror/closebrackets': cmAutocomplete,
  '@codemirror/comment': cmCommands,
  '@codemirror/fold': cmLanguage,
  '@codemirror/gutter': cmView,
  '@codemirror/highlight': cmLanguage,
  '@codemirror/history': cmCommands,
  '@codemirror/matchbrackets': cmLanguage,
  '@codemirror/panel': cmView,
  '@codemirror/rangeset': cmState,
  '@codemirror/rectangular-selection': cmView,
  '@codemirror/stream-parser': cmLanguage,
  '@codemirror/tooltip': cmView
}

export function createRequire(apiModule: any, pluginId: string): (name: string) => any {
  const known = getKnownModules(apiModule)
  return (name: string): any => {
    if (Object.prototype.hasOwnProperty.call(DEPRECATED_MODULES, name)) {
      console.error(`Plugin "${pluginId}" uses the deprecated module "${name}"; it was merged into a newer CodeMirror package and may not work correctly.`)
      return DEPRECATED_MODULES[name]
    }
    if (Object.prototype.hasOwnProperty.call(known, name)) return known[name]
    const nodeReq = (window as any).require
    if (typeof nodeReq !== 'function') throw new Error(`Cannot find module '${name}'`)
    return nodeReq(name)
  }
}
