/* eslint-disable @typescript-eslint/no-explicit-any */
// The object handed out as `require('obsidian')`: all 159 exports of the plugin API
// module, assembled from Quartz's implementations. Names without a full Quartz
// implementation are minimal working versions (see MINIMAL_EXPORTS).
import { Component } from '../core/Component'
import { Events } from '../core/Events'
import { App } from '../App'
import { Vault } from '../vault/Vault'
import { FileSystemAdapter } from '../vault/FileSystemAdapter'
import { TAbstractFile, TFile, TFolder } from '../vault/TAbstractFile'
import { normalizePath } from '../vault/path'
import { debounce } from '../vault/debounce'
import { MetadataCache } from '../metadata/MetadataCache'
import { FileManager } from '../FileManager'
import { getLinkpath, parseLinktext, stripHeading, stripHeadingForLink } from '../metadata/linktext'
import {
  getAllTags, iterateCacheRefs, iterateRefs, parseFrontMatterAliases, parseFrontMatterEntry,
  parseFrontMatterStringArray, parseFrontMatterTags
} from '../metadata/helpers'
import { getFrontMatterInfo } from '../metadata/linkUpdate'
import { Keymap, Scope } from '../keymap/Keymap'
import { Platform } from '../keymap/Platform'
import * as ui from '../ui'
import {
  MarkdownPreviewRenderer, MarkdownSection, MarkdownRenderChild, MarkdownRenderer, MarkdownPreviewView, sanitizeHTMLToDom, resolveSubpath
} from '../markdown'
import { loadPrism } from '../markdown/prism'
import { htmlToMarkdown } from '../editor/clipboard'
import { Editor } from '../editor/Editor'
import { renderMath, finishRenderMath, loadMathJax } from '../editor/livepreview'
import { MarkdownView } from '../views/markdown/MarkdownView'
import {
  Workspace, WorkspaceItem, WorkspaceParent, WorkspaceSplit, WorkspaceSidedock, WorkspaceRoot, WorkspaceFloating,
  WorkspaceWindow, WorkspaceTabs, WorkspaceLeaf, WorkspaceRibbon, WorkspaceContainer, ViewRegistry, View, ItemView,
  FileView, EditableFileView, TextFileView
} from '../workspace'
import { Plugin } from './Plugin'
import { PluginSettingTab, SettingTab, SettingPage } from './settingTab'
import * as extras from './extras'
import { editorEditorField, editorInfoField, editorViewField, livePreviewState } from './editorFields'
import { editorLivePreviewField } from '../editor/editorExtensions'

/** Exports that are minimal (not full) implementations. */
export const MINIMAL_EXPORTS = [
  'CapacitorAdapter', 'TExternalFile', 'SecretStorage',
  'SecretComponent', 'RenderContext', 'loadPdfJs', 'parsePropertyId', 'EditorSuggest'
]

/** Mobile adapter; Quartz is desktop-only, so this is the desktop adapter under the mobile name. */
class CapacitorAdapter extends FileSystemAdapter {}

class SecretComponent extends (ui.BaseComponent as any) {
  inputEl: HTMLInputElement
  private cb: ((v: string) => unknown) | null = null
  constructor(public app: any, containerEl: HTMLElement) {
    super()
    this.inputEl = containerEl.createEl('input', { type: 'password' } as any)
    this.inputEl.addEventListener('input', () => this.cb?.(this.inputEl.value))
  }
  setValue(v: string): this {
    this.inputEl.value = v
    return this
  }
  onChange(cb: (v: string) => unknown): this {
    this.cb = cb
    return this
  }
}

function fuzzySearchCompat(query: any, text: string): any {
  return (ui as any).fuzzySearch(query, text)
}

/** Builds the `obsidian` module namespace object. */
export function createApiModule(): Record<string, any> {
  const m: Record<string, any> = {
    // core
    Component, Events, App, Vault, FileSystemAdapter, CapacitorAdapter, TAbstractFile, TFile, TFolder,
    TExternalFile: extras.TExternalFile, MetadataCache, FileManager, Keymap, Scope, Platform,
    // ui kit
    AbstractInputSuggest: ui.AbstractInputSuggest, AbstractTextComponent: ui.AbstractTextComponent,
    BaseComponent: ui.BaseComponent, ButtonComponent: ui.ButtonComponent, ColorComponent: ui.ColorComponent,
    ConfirmationButton: ui.ConfirmationButton, ConfirmationModal: ui.ConfirmationModal, DropdownComponent: ui.DropdownComponent,
    ExtraButtonComponent: ui.ExtraButtonComponent, FuzzySuggestModal: ui.FuzzySuggestModal, HoverPopover: ui.HoverPopover,
    Menu: ui.Menu, MenuItem: ui.MenuItem, MenuSeparator: ui.MenuSeparator, Modal: ui.Modal,
    MomentFormatComponent: ui.MomentFormatComponent, Notice: ui.Notice, PopoverState: ui.PopoverState,
    PopoverSuggest: ui.PopoverSuggest, ProgressBarComponent: ui.ProgressBarComponent, SearchComponent: ui.SearchComponent,
    SecretComponent, Setting: ui.Setting, SettingGroup: ui.SettingGroup, SliderComponent: ui.SliderComponent,
    SuggestModal: ui.SuggestModal, TextAreaComponent: ui.TextAreaComponent, TextComponent: ui.TextComponent,
    ToggleComponent: ui.ToggleComponent, ValueComponent: ui.ValueComponent,
    SettingTab, SettingPage, PluginSettingTab, Plugin,
    addIcon: ui.addIcon, removeIcon: ui.removeIcon, setIcon: ui.setIcon, getIcon: ui.getIcon, getIconIds: ui.getIconIds,
    setTooltip: ui.setTooltip, displayTooltip: ui.displayTooltip, request: ui.request, requestUrl: ui.requestUrl,
    moment: ui.moment, debounce,
    // fuzzy search
    prepareFuzzySearch: ui.prepareFuzzySearch, prepareSimpleSearch: ui.prepareSimpleSearch, prepareQuery: ui.prepareQuery,
    fuzzySearch: fuzzySearchCompat, renderMatches: ui.renderMatches, renderResults: ui.renderResults,
    sortSearchResults: ui.sortSearchResults,
    // markdown
    MarkdownPreviewRenderer, MarkdownPreviewSection: MarkdownSection, MarkdownPreviewView, MarkdownRenderChild,
    MarkdownRenderer, MarkdownView, Editor, EditorSuggest: extras.EditorSuggest, RenderContext: extras.RenderContext,
    htmlToMarkdown, sanitizeHTMLToDom, renderMath, finishRenderMath, loadMathJax, loadPrism,
    loadMermaid: extras.loadMermaid, loadPdfJs: extras.loadPdfJs,
    // workspace / views
    Workspace, WorkspaceItem, WorkspaceParent, WorkspaceSplit, WorkspaceSidedock, WorkspaceRoot, WorkspaceFloating,
    WorkspaceWindow, WorkspaceTabs, WorkspaceLeaf, WorkspaceRibbon, WorkspaceContainer, ViewRegistry, View, ItemView,
    FileView, EditableFileView, TextFileView,
    // editor fields
    editorEditorField, editorInfoField, editorLivePreviewField, editorViewField, livePreviewState,
    // metadata helpers
    getAllTags, getFrontMatterInfo, getLinkpath, iterateCacheRefs, iterateRefs, normalizePath, parseFrontMatterAliases,
    parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags, parseLinktext, stripHeading,
    stripHeadingForLink, resolveSubpath,
    // misc
    apiVersion: extras.apiVersion, requireApiVersion: extras.requireApiVersion, getLanguage: extras.getLanguage,
    parseYaml: extras.parseYaml, stringifyYaml: extras.stringifyYaml, parsePropertyId: extras.parsePropertyId,
    arrayBufferToBase64: extras.arrayBufferToBase64, base64ToArrayBuffer: extras.base64ToArrayBuffer,
    arrayBufferToHex: extras.arrayBufferToHex, hexToArrayBuffer: extras.hexToArrayBuffer, getBlobArrayBuffer: extras.getBlobArrayBuffer,
    SecretStorage: extras.SecretStorage,
    // Bases
    BasesView: extras.BasesView, BasesViewConfig: extras.BasesViewConfig, BasesEntry: extras.BasesEntry,
    BasesEntryGroup: extras.BasesEntryGroup, BasesQueryResult: extras.BasesQueryResult, QueryController: extras.QueryController,
    Value: extras.Value, NullValue: extras.NullValue, NotNullValue: extras.NotNullValue, PrimitiveValue: extras.PrimitiveValue,
    StringValue: extras.StringValue, NumberValue: extras.NumberValue, BooleanValue: extras.BooleanValue,
    DateValue: extras.DateValue, RelativeDateValue: extras.RelativeDateValue, DurationValue: extras.DurationValue,
    ListValue: extras.ListValue, ObjectValue: extras.ObjectValue, LinkValue: extras.LinkValue, FileValue: extras.FileValue,
    UrlValue: extras.UrlValue, TagValue: extras.TagValue, HTMLValue: extras.HTMLValue, IconValue: extras.IconValue,
    ImageValue: extras.ImageValue, RegExpValue: extras.RegExpValue
  }
  return m
}

let cached: Record<string, any> | null = null
/** The singleton module object (same instance for every plugin and `window.__quartz`). */
export function getApiModule(): Record<string, any> {
  if (!cached) {
    cached = createApiModule()
  }
  return cached
}

/** The 159 export names of the `obsidian` plugin API module. */
export const API_EXPORT_NAMES = (
  'AbstractInputSuggest AbstractTextComponent App BaseComponent BasesEntry BasesEntryGroup BasesQueryResult BasesView BasesViewConfig ' +
  'BooleanValue ButtonComponent CapacitorAdapter ColorComponent Component ConfirmationButton ConfirmationModal DateValue DropdownComponent ' +
  'DurationValue EditableFileView Editor EditorSuggest Events ExtraButtonComponent FileManager FileSystemAdapter FileValue FileView ' +
  'FuzzySuggestModal HTMLValue HoverPopover IconValue ImageValue ItemView Keymap LinkValue ListValue MarkdownPreviewRenderer ' +
  'MarkdownPreviewSection MarkdownPreviewView MarkdownRenderChild MarkdownRenderer MarkdownView Menu MenuItem MenuSeparator MetadataCache ' +
  'Modal MomentFormatComponent NotNullValue Notice NullValue NumberValue ObjectValue Platform Plugin PluginSettingTab PopoverState ' +
  'PopoverSuggest PrimitiveValue ProgressBarComponent QueryController RegExpValue RelativeDateValue RenderContext Scope SearchComponent ' +
  'SecretComponent SecretStorage Setting SettingGroup SettingPage SettingTab SliderComponent StringValue SuggestModal TAbstractFile ' +
  'TExternalFile TFile TFolder TagValue TextAreaComponent TextComponent TextFileView ToggleComponent UrlValue Value ValueComponent Vault ' +
  'View ViewRegistry Workspace WorkspaceContainer WorkspaceFloating WorkspaceItem WorkspaceLeaf WorkspaceParent WorkspaceRibbon ' +
  'WorkspaceRoot WorkspaceSidedock WorkspaceSplit WorkspaceTabs WorkspaceWindow addIcon apiVersion arrayBufferToBase64 arrayBufferToHex ' +
  'base64ToArrayBuffer debounce displayTooltip editorEditorField editorInfoField editorLivePreviewField editorViewField finishRenderMath ' +
  'fuzzySearch getAllTags getBlobArrayBuffer getFrontMatterInfo getIcon getIconIds getLanguage getLinkpath hexToArrayBuffer htmlToMarkdown ' +
  'iterateCacheRefs iterateRefs livePreviewState loadMathJax loadMermaid loadPdfJs loadPrism moment normalizePath parseFrontMatterAliases ' +
  'parseFrontMatterEntry parseFrontMatterStringArray parseFrontMatterTags parseLinktext parsePropertyId parseYaml prepareFuzzySearch ' +
  'prepareQuery prepareSimpleSearch removeIcon renderMatches renderMath renderResults request requestUrl requireApiVersion resolveSubpath ' +
  'sanitizeHTMLToDom setIcon setTooltip sortSearchResults stringifyYaml stripHeading stripHeadingForLink'
).split(' ')
