// UI kit — public entry. Same names/signatures as the plugin API (obsidian.d.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Notice } from './Notice'
import { initTooltips } from './tooltip'
import { installPointerTracking } from './dom'

export { Menu, MenuItem, MenuSeparator, closeAllMenus, updateUseNativeMenu } from './Menu'
export type { MenuPositionDef } from './Menu'
export { Modal, ConfirmationModal, ConfirmationButton } from './Modal'
export { SuggestModal, FuzzySuggestModal, PopoverSuggest, AbstractInputSuggest, SuggestionChooser } from './suggest'
export type { Instruction, ISuggestOwner, FuzzyMatch } from './suggest'
export { Notice } from './Notice'
export {
  Setting,
  SettingGroup,
  BaseComponent,
  ValueComponent,
  ButtonComponent,
  ExtraButtonComponent,
  ToggleComponent,
  AbstractTextComponent,
  TextComponent,
  TextAreaComponent,
  SearchComponent,
  MomentFormatComponent,
  DropdownComponent,
  SliderComponent,
  ColorComponent,
  ProgressBarComponent,
  DisplayValueComponent
} from './setting'
export type { RGB, HSL, HexString } from './setting'
export { HoverPopover, PopoverState } from './HoverPopover'
export type { HoverParent, Point } from './HoverPopover'
export { setIcon, getIcon, getIconIds, addIcon, removeIcon } from './icons'
export { setTooltip, displayTooltip, hideTooltip, initTooltips, TOOLTIP_DELAY, TOOLTIP_DELAY_SLOW } from './tooltip'
export type { TooltipOptions, TooltipPlacement } from './tooltip'
export { requestUrl, request, RequestUrlError } from './request'
export type { RequestUrlParam, RequestUrlResponse, RequestUrlResponsePromise } from './request'
export { moment } from './moment'
export { debounce } from '../vault/debounce'
export type { Debouncer } from '../vault/debounce'
export { Platform } from '../keymap/Platform'
export { renderMatches, renderResults, prepareFuzzySearch, prepareSimpleSearch, prepareQuery, fuzzySearch, sortSearchResults } from '../search/fuzzy'

if (typeof window !== 'undefined') (window as any).Notice = Notice

/** Installs the per-document listeners the kit relies on (hover tooltips, touch detection). */
export function initUiKit(doc: Document = document): void {
  installPointerTracking(doc)
  initTooltips(doc)
}
