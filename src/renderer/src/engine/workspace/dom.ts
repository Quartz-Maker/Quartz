// DOM helpers used by the workspace layer. The implementations live in the UI kit
// (engine/ui/icons.ts, engine/ui/tooltip.ts) — the canonical icon provider and tooltip
// manager; this module re-exports them for the workspace/view code.
export { setIcon, getIcon, setIconProvider } from '../ui/icons'
export type { IconProvider } from '../ui/icons'
export { setTooltip, setDynamicTooltip, getDynamicTooltip, TOOLTIP_DELAY, TOOLTIP_DELAY_SLOW } from '../ui/tooltip'
export type { TooltipOptions } from '../ui/tooltip'
