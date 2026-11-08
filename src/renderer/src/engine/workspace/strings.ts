// English UI strings used by the workspace layer (keyed by i18n key).
// Replace with the i18n module once it exists.
export const t = {
  emptySidebar: 'The sidebar is empty, try dragging a tab here.', // interface.emptySidebar
  sidebarExpand: 'Expand', // interface.sidebarExpand
  sidebarCollapse: 'Collapse', // interface.sidebarCollapse
  msgFailedToLoadFile: (filepath: string) => `Failed to open “${filepath}”`, // interface.msgFailedToLoadFile
  msgFailedToCloseView: (name: string) => `The “${name}” view encountered an error while closing`,
  noFile: 'No file', // interface.noFile
  manageVaults: 'Manage vaults...',
  labelNewTab: 'New tab', // interface.labelNewTab
  optionHideRibbon: 'Hide ribbon',
  msgTabBusy: 'This tab is currently busy, please try again later',
  goToFile: 'Go to file', // interface.emptyState.goToFile
  emptyClose: 'Close', // interface.emptyState.close
  emptyCloseAll: (id: string, count: number) => `Close all “${id}” tabs (${count})`,
  unknownPaneTitle: 'Plugin no longer active',
  unknownPaneDesc: (type: string) => `The plugin that created this tab (${type}) has gone away.`,
  menu: {
    ribbon: 'Ribbon',
    leftSidebar: 'Left sidebar',
    rightSidebar: 'Right sidebar',
    moreOptions: 'More options',
    close: 'Close',
    closeAll: 'Close all',
    closeOthers: 'Close others',
    closeAfter: 'Close tabs after',
    pin: 'Pin',
    unpin: 'Unpin',
    unlinkTab: 'Unlink tab',
    linkTab: 'Link with tab...',
    copyPath: 'Copy path',
    moveToNewWindow: 'Move to new window',
    stackTabs: 'Stack tabs',
    unstackTabs: 'Unstack tabs',
    openLinkedView: 'Open linked view'
  },
  splitRight: 'Split right', // commands.splitRight
  splitDown: 'Split down',
  navigateBack: 'Navigate back',
  navigateForward: 'Navigate forward',
  msgUnsupportedFileType: (ext: string) => `Quartz can’t open “.${ext}” files.`,
  newNote: 'New note', // plugins.fileExplorer.actionNewNote
  newFolder: 'New folder', // plugins.fileExplorer.menuOptNewFolder
  revealInNav: 'Reveal file in navigation', // plugins.fileExplorer.actionRevealFile
  openWebViewer: 'Open web viewer',
  newCanvas: 'New canvas',
  newBase: 'New base',
  fileWithCount: (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`,
  folderWithCount: (n: number) => `${n} ${n === 1 ? 'folder' : 'folders'}`
}
