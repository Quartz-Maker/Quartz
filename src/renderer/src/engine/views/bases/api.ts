/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin-facing Bases API (obsidian.d.ts): BasesView, BasesViewConfig, BasesEntry, BasesEntryGroup,
// BasesQueryResult, QueryController and the registration shape.
import { Component } from '../../core/Component'
import { ViewConfig } from './BaseConfig'
import { BasesEntry } from './context'
import { BasesEntryGroup, BasesQueryResult } from './query'
import { QueryController } from './QueryController'

export { BasesEntry, BasesEntryGroup, BasesQueryResult, QueryController }
export class BasesViewConfig extends ViewConfig {}
export { ViewConfig }

export interface BasesViewRegistration {
  name: string
  icon: string
  factory: (controller: QueryController, containerEl: HTMLElement) => BasesView
  options?: (config: ViewConfig) => any[]
}

export abstract class BasesView extends Component {
  abstract type: string
  app: any
  /** Replaced with a new result set when the vault or config changes. */
  data!: BasesQueryResult
  allProperties: string[] = []
  protected constructor(public controller: QueryController) {
    super()
    this.app = controller.app
  }
  get config(): ViewConfig {
    return this.controller.getViewConfig() as ViewConfig
  }
  abstract onDataUpdated(): void
  async createFileForView(baseFileName?: string, frontmatterProcessor?: (fm: any) => void): Promise<void> {
    await this.controller.createFileForView(baseFileName, frontmatterProcessor)
  }
}
