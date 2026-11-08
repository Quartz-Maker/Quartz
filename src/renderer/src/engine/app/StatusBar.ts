// `.status-bar` (child of `.app-container`). Each plugin gets
// `div.status-bar-item.plugin-<id>`; `addStatusBarItem()` is the plugin API.
export class StatusBar {
  containerEl: HTMLElement

  constructor(parent: HTMLElement) {
    this.containerEl = parent.createDiv('status-bar')
  }

  /** Sanitise the id into a class name (`plugin-<id>` with non-word chars → `-`). */
  createStatusBarItem(pluginId: string): HTMLElement {
    const cls = 'plugin-' + pluginId.toLowerCase().replace(/[^_a-zA-Z0-9-]/g, '-')
    return this.containerEl.createDiv({ cls: ['status-bar-item', cls] })
  }
}
