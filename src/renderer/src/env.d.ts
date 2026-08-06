import type { ElectronAPI } from '../../preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

declare module '*.png' {
  const src: string
  export default src
}

export {}
