// English strings for main-process dialogs (`i18n.main.*`).
export const S = {
  buttonCancel: 'Cancel',
  buttonOk: 'OK',
  buttonCopy: 'Copy',
  buttonOpenLink: 'Open Link',
  buttonOpenFile: 'Open this file',
  buttonRunFile: 'Run File',
  buttonAllow: 'Allow',
  externalLinkTitle: 'Open external link?',
  externalLinkMessage:
    'This link will open an external application outside of Quartz. Only proceed if you trust the source of this link.',
  externalLinkAlwaysOpen: (scheme: string): string => `Always open ${scheme}:// links`,
  remoteFileTitle: 'Remote file warning',
  remoteFileMessage: 'This file is located on a remote server, and may be dangerous.\nAre you sure you want to open it?',
  remoteFileLocation: (location: string): string => `Location: ${location}`,
  networkDriveTitle: 'Network drive access',
  networkDriveMessage:
    'This content is requesting data from a network drive. Allowing this may expose your login credentials or other sensitive information to the remote host.',
  networkDriveHost: (host: string): string => `Host: ${host}`,
  executableFileTitle: 'Run executable file?',
  executableFileMessage: 'This link points to an executable file. Running it could harm your computer.',
  executableFileLocation: (path: string): string => `File: ${path}`,
  vaultNotFoundTitle: 'Vault not found.',
  vaultNotFoundMessage: (url: string): string => `Unable to find a vault for the URL ${url}`,
  supportedFiles: 'Supported files'
}
