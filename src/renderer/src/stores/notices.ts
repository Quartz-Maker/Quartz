// Notices are shown by the UI kit (`new Notice(message, duration)`, engine/ui/Notice.ts:
// `.notice-container > .notice > .notice-message`, hover pauses, click dismisses, 0 = sticky).
// This store keeps its previous API for existing callers.
import { createStore as create } from 'zustand/vanilla'
import { Notice as UiNotice } from '@/engine/ui/Notice'

export interface Notice {
  id: string
  message: string
  duration: number
  createdAt: number
}

interface NoticeState {
  /** @deprecated notices are DOM-managed by the UI kit; always empty */
  notices: Notice[]
  addNotice: (message: string | DocumentFragment, duration?: number) => UiNotice
  removeNotice: (id: string) => void
}

export const useNoticeStore = create<NoticeState>(() => ({
  notices: [],
  addNotice: (message: string | DocumentFragment, duration: number = 4000) => new UiNotice(message, duration),
  removeNotice: () => {}
}))
