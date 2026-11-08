// Plugin API `MarkdownRenderChild`: a Component bound to a container element inside rendered markdown.
import { Component } from '../core/Component'

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement
  constructor(containerEl: HTMLElement) {
    super()
    this.containerEl = containerEl
  }
}
