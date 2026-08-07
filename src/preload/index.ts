import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type OperationLog = {
  time: string
  deviceId: string
  deviceName: string
  action: string
  result: string
  detail?: string
}

export type LocalFileInfo = {
  name: string
  path: string
  size: number
  modified: number
}

export type BambuRegion = 'china' | 'global'

export type BambuCloudDevice = {
  dev_id: string
  name: string
  online: boolean
  print_status?: string
  dev_model_name?: string
  dev_product_name?: string
  dev_access_code?: string
}

export type BambuMqttConnectOpts = {
  connectionId: string
  serial: string
  mode: 'lan' | 'cloud'
  host?: string
  region?: BambuRegion
  password: string
  userId?: string
}

export type BambuLivePatch = {
  connectionId: string
  health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
  state: string
  progress: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: { actual: number; target: number }
  bed?: { actual: number; target: number }
  boardTemp?: number
  chamberTemp?: number
  fanSpeed?: number
  chamberFanSpeed?: number
  printSpeed?: number
  filename?: string
  gcodeFile?: string
  amsSlots?: Array<{ id: number; material: string; color: string; remain: number }>
  message?: string
  updatedAt: string
}

export type BambuLoginResult =
  | { ok: true; accessToken: string }
  | { ok: false; needCode: true; message: string; via: 'sms' | 'email' }
  | { ok: false; needCode: false; message: string }

const api = {
  app: {
    getRole: () => ipcRenderer.invoke('app:getRole') as Promise<'server' | 'client'>
  },
  auth: {
    localUsers: () =>
      ipcRenderer.invoke('auth:localUsers') as Promise<{
        ok: boolean
        users?: Array<{
          id: string
          username: string
          displayName: string
          level: string
          enabled: boolean
          permissions: string[]
          deviceAcl: Record<string, string[]>
          createdAt: string
          updatedAt: string
        }>
        message?: string
      }>,
    localUpsertUser: (payload: unknown) =>
      ipcRenderer.invoke('auth:localUpsertUser', payload) as Promise<{
        ok: boolean
        user?: unknown
        message?: string
      }>,
    localDeleteUser: (id: string) =>
      ipcRenderer.invoke('auth:localDeleteUser', id) as Promise<{ ok: boolean; message?: string }>,
    localPrintRequests: (filter?: { status?: string; deviceId?: string }) =>
      ipcRenderer.invoke('auth:localPrintRequests', filter) as Promise<{
        ok: boolean
        requests?: unknown[]
        message?: string
      }>,
    localReviewPrint: (payload: {
      id: string
      action: 'approve' | 'reject' | 'start' | 'cancel'
      note?: string
    }) =>
      ipcRenderer.invoke('auth:localReviewPrint', payload) as Promise<{
        ok: boolean
        request?: unknown
        message?: string
      }>,
    localSubmitPrint: (payload: {
      deviceId: string
      deviceName?: string
      filename: string
      contentBase64: string
      note?: string
      status?: 'pending' | 'queued'
    }) =>
      ipcRenderer.invoke('auth:localSubmitPrint', payload) as Promise<{
        ok: boolean
        request?: unknown
        queued?: boolean
        queuePosition?: number
        message?: string
      }>
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<boolean>,
    maximize: () => ipcRenderer.invoke('window:maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close') as Promise<boolean>,
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>
  },
  secrets: {
    get: (key: string) => ipcRenderer.invoke('secrets:get', key) as Promise<string | null>,
    set: (key: string, value: string) => ipcRenderer.invoke('secrets:set', key, value) as Promise<boolean>,
    delete: (key: string) => ipcRenderer.invoke('secrets:delete', key) as Promise<boolean>
  },
  devices: {
    load: () => ipcRenderer.invoke('devices:load') as Promise<unknown[]>,
    save: (devices: unknown) => ipcRenderer.invoke('devices:save', devices) as Promise<boolean>,
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('devices:changed', handler)
      return () => ipcRenderer.removeListener('devices:changed', handler)
    }
  },
  filament: {
    load: () => ipcRenderer.invoke('filament:load') as Promise<unknown[]>,
    save: (spools: unknown) => ipcRenderer.invoke('filament:save', spools) as Promise<boolean>,
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('filament:changed', handler)
      return () => ipcRenderer.removeListener('filament:changed', handler)
    }
  },
  monitor: {
    load: () => ipcRenderer.invoke('monitor:load') as Promise<unknown[]>,
    save: (zones: unknown) => ipcRenderer.invoke('monitor:save', zones) as Promise<boolean>,
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('monitor:changed', handler)
      return () => ipcRenderer.removeListener('monitor:changed', handler)
    }
  },
  settings: {
    load: () =>
      ipcRenderer.invoke('settings:load') as Promise<{
        apiEnabled: boolean
        apiMode: 'readonly' | 'control'
        apiPort: number
        apiKey: string
        apiAccessMode?: 'local' | 'sunlogin' | 'frpc'
        publicIp?: string
        domain?: string
        hskEnabled?: boolean
        hskApiKey?: string
        hskDomain?: string
        hskExternalPort?: number
        hskFwType?: 1 | 2 | 3
        hskMemo?: string
        frpcServerAddr?: string
        frpcServerPort?: number
        frpcUser?: string
        frpcToken?: string
        frpcProxyName?: string
        frpcType?: 'tcp' | 'http'
        frpcRemotePort?: number
        frpcPublicHost?: string
        frpcCustomDomain?: string
        frpcTlsEnable?: boolean
        notifyOnError?: boolean
        notifyOnPrintDone?: boolean
        notifyOnIdle?: boolean
        notifyOnLowFilament?: boolean
        amsAutoDeduct?: boolean
        deviceRefreshSec?: number
        openAtLogin?: boolean
        minimizeToTray?: boolean
        uiTheme?: string
        uiBgMode?: string
        uiBgColor?: string
        uiBgImage?: string
      }>,
    save: (settings: unknown) =>
      ipcRenderer.invoke('settings:save', settings) as Promise<{
        settings: {
          apiEnabled: boolean
          apiMode: 'readonly' | 'control'
          apiPort: number
          apiKey: string
          apiAccessMode?: 'local' | 'sunlogin' | 'frpc'
          publicIp?: string
          domain?: string
          hskEnabled?: boolean
          hskApiKey?: string
          hskDomain?: string
          hskExternalPort?: number
          hskFwType?: 1 | 2 | 3
          hskMemo?: string
          frpcServerAddr?: string
          frpcServerPort?: number
          frpcUser?: string
          frpcToken?: string
          frpcProxyName?: string
          frpcType?: 'tcp' | 'http'
          frpcRemotePort?: number
          frpcPublicHost?: string
          frpcCustomDomain?: string
          frpcTlsEnable?: boolean
          notifyOnError?: boolean
          notifyOnPrintDone?: boolean
          notifyOnIdle?: boolean
          notifyOnLowFilament?: boolean
          amsAutoDeduct?: boolean
          deviceRefreshSec?: number
          openAtLogin?: boolean
          minimizeToTray?: boolean
          uiTheme?: string
          uiBgMode?: string
          uiBgColor?: string
          uiBgImage?: string
        }
        status: {
          running: boolean
          port: number
          mode: 'readonly' | 'control'
          localUrls: string[]
          publicUrl: string | null
          domainUrl: string | null
          hskUrl: string | null
          frpcUrl: string | null
          error?: string
        }
      }>,
    pickBackgroundImage: () =>
      ipcRenderer.invoke('settings:pickBackgroundImage') as Promise<
        { ok: true; dataUrl: string } | { ok: false; message?: string }
      >
  },
  api: {
    status: () =>
      ipcRenderer.invoke('api:status') as Promise<{
        running: boolean
        port: number
        mode: 'readonly' | 'control'
        localUrls: string[]
        publicUrl: string | null
        domainUrl: string | null
        hskUrl: string | null
        frpcUrl: string | null
        error?: string
      }>,
    start: () => ipcRenderer.invoke('api:start') as Promise<{
      running: boolean
      port: number
      mode: 'readonly' | 'control'
      localUrls: string[]
      publicUrl: string | null
      domainUrl: string | null
      hskUrl: string | null
      frpcUrl: string | null
      error?: string
    }>,
    stop: () => ipcRenderer.invoke('api:stop') as Promise<{
      running: boolean
      port: number
      mode: 'readonly' | 'control'
      localUrls: string[]
      publicUrl: string | null
      domainUrl: string | null
      hskUrl: string | null
      frpcUrl: string | null
      error?: string
    }>,
    pushStatuses: (statuses: unknown) =>
      ipcRenderer.invoke('api:pushStatuses', statuses) as Promise<boolean>,
    onControlRequest: (
      listener: (req: { requestId: string; deviceId: string; payload: unknown }) => void
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        req: { requestId: string; deviceId: string; payload: unknown }
      ) => listener(req)
      ipcRenderer.on('api:control-request', handler)
      return () => ipcRenderer.removeListener('api:control-request', handler)
    },
    replyControl: (result: { requestId: string; ok: boolean; message?: string }) => {
      ipcRenderer.send('api:control-result', result)
    },
    onReconnectRequest: (listener: (req: { requestId: string }) => void) => {
      const handler = (_event: IpcRendererEvent, req: { requestId: string }) => listener(req)
      ipcRenderer.on('api:reconnect-request', handler)
      return () => ipcRenderer.removeListener('api:reconnect-request', handler)
    },
    replyReconnect: (result: { requestId: string; ok: boolean; message?: string }) => {
      ipcRenderer.send('api:reconnect-result', result)
    },
    onDeviceOpRequest: (
      listener: (req: {
        requestId: string
        deviceId: string
        op: 'listFiles' | 'uploadFile' | 'downloadFile'
        filename?: string
        contentBase64?: string
        remotePath?: string
      }) => void
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        req: {
          requestId: string
          deviceId: string
          op: 'listFiles' | 'uploadFile' | 'downloadFile'
          filename?: string
          contentBase64?: string
          remotePath?: string
        }
      ) => listener(req)
      ipcRenderer.on('api:device-op-request', handler)
      return () => ipcRenderer.removeListener('api:device-op-request', handler)
    },
    replyDeviceOp: (result: {
      requestId: string
      ok: boolean
      message?: string
      files?: Array<{ path: string; size: number; modified?: number }>
      filename?: string
      contentBase64?: string
      contentType?: string
    }) => {
      ipcRenderer.send('api:device-op-result', result)
    },
    onBatchPrintRequest: (
      listener: (req: {
        requestId: string
        deviceIds: string[]
        filename: string
        contentBase64?: string
      }) => void
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        req: {
          requestId: string
          deviceIds: string[]
          filename: string
          contentBase64?: string
        }
      ) => listener(req)
      ipcRenderer.on('api:batch-print-request', handler)
      return () => ipcRenderer.removeListener('api:batch-print-request', handler)
    },
    replyBatchPrint: (result: {
      requestId: string
      ok: boolean
      results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
    }) => {
      ipcRenderer.send('api:batch-print-result', result)
    }
  },
  hsk: {
    fetchMeta: (apiKey?: string) =>
      ipcRenderer.invoke('hsk:fetchMeta', apiKey) as Promise<
        | {
            ok: true
            domains: Array<{ domainname: string; account?: string; expiredate?: number }>
            mappings: Array<{
              memo?: string
              domain: string
              port: number
              servicehost?: string
              serviceport?: number
              fwtype?: number
              isforbid?: boolean
            }>
          }
        | { ok: false; message: string }
      >,
    syncMapping: (payload?: {
      apiKey?: string
      domain?: string
      fwType?: number
      memo?: string
    }) =>
      ipcRenderer.invoke('hsk:syncMapping', payload) as Promise<
        | {
            ok: true
            mapping: {
              memo?: string
              domain: string
              port: number
              servicehost?: string
              serviceport?: number
              fwtype?: number
            }
            hskDomain: string
            hskExternalPort: number
            hskFwType: 1 | 2 | 3
            settings: {
              apiEnabled: boolean
              apiMode: 'readonly' | 'control'
              apiPort: number
              apiKey: string
              apiAccessMode?: 'local' | 'sunlogin' | 'frpc'
              publicIp?: string
              domain?: string
              hskEnabled?: boolean
              hskApiKey?: string
              hskDomain?: string
              hskExternalPort?: number
              hskFwType?: 1 | 2 | 3
              hskMemo?: string
              frpcServerAddr?: string
              frpcServerPort?: number
              frpcUser?: string
              frpcToken?: string
              frpcProxyName?: string
              frpcType?: 'tcp' | 'http'
              frpcRemotePort?: number
              frpcPublicHost?: string
              frpcCustomDomain?: string
              frpcTlsEnable?: boolean
            }
            status: {
              running: boolean
              port: number
              mode: 'readonly' | 'control'
              localUrls: string[]
              publicUrl: string | null
              domainUrl: string | null
              hskUrl: string | null
              frpcUrl: string | null
              error?: string
            }
          }
        | { ok: false; message: string }
      >
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<boolean>
  },
  frpc: {
    exportConfig: () =>
      ipcRenderer.invoke('frpc:exportConfig') as Promise<{ ok: true; path: string }>,
    getToml: () => ipcRenderer.invoke('frpc:getToml') as Promise<string>
  },
  notify: {
    show: (title: string, body: string) => ipcRenderer.invoke('notify:show', title, body) as Promise<boolean>
  },
  logs: {
    append: (entry: OperationLog) => ipcRenderer.invoke('logs:append', entry) as Promise<boolean>,
    read: () => ipcRenderer.invoke('logs:read') as Promise<OperationLog[]>,
    export: () => ipcRenderer.invoke('logs:export') as Promise<{ ok: boolean; path: string | null }>
  },
  localFiles: {
    save: (payload: { fileName: string; data: ArrayBuffer | Uint8Array; subdir?: string }) =>
      ipcRenderer.invoke('localFiles:save', payload) as Promise<{ ok: boolean; path: string }>,
    saveAs: (payload: { fileName: string; data: ArrayBuffer | Uint8Array }) =>
      ipcRenderer.invoke('localFiles:saveAs', payload) as Promise<{ ok: boolean; path: string | null }>,
    list: () => ipcRenderer.invoke('localFiles:list') as Promise<LocalFileInfo[]>,
    getDir: () => ipcRenderer.invoke('localFiles:getDir') as Promise<string>,
    openDir: () => ipcRenderer.invoke('localFiles:openDir') as Promise<boolean>
  },
  dataRoot: {
    get: () =>
      ipcRenderer.invoke('dataRoot:get') as Promise<{
        root: string
        defaultRoot: string
        downloads: string
        isCustom: boolean
      }>,
    open: () => ipcRenderer.invoke('dataRoot:open') as Promise<boolean>,
    choose: () =>
      ipcRenderer.invoke('dataRoot:choose') as Promise<
        { ok: true; path: string } | { ok: false; cancelled: true }
      >,
    set: (payload: { path?: string; migrate?: boolean; reset?: boolean }) =>
      ipcRenderer.invoke('dataRoot:set', payload) as Promise<
        | {
            ok: true
            root: string
            defaultRoot: string
            downloads: string
            migrated: boolean
            copied?: string[]
            settings?: unknown
            message: string
          }
        | { ok: false; message: string }
      >
  },
  bambu: {
    checkPlugin: () =>
      ipcRenderer.invoke('bambu:checkPlugin') as Promise<{ installed: boolean; hint: string }>,
    login: (payload: { region: BambuRegion; account: string; password: string }) =>
      ipcRenderer.invoke('bambu:login', payload) as Promise<BambuLoginResult>,
    loginWithCode: (payload: { region: BambuRegion; account: string; code: string }) =>
      ipcRenderer.invoke('bambu:loginWithCode', payload) as Promise<BambuLoginResult>,
    sendCode: (payload: { region: BambuRegion; account: string }) =>
      ipcRenderer.invoke('bambu:sendCode', payload) as Promise<{
        ok: boolean
        message: string
        via: 'sms' | 'email'
      }>,
    fetchDevices: (payload: { region: BambuRegion; token: string }) =>
      ipcRenderer.invoke('bambu:fetchDevices', payload) as Promise<{
        ok: boolean
        devices: BambuCloudDevice[]
        uid: string | null
        message?: string
      }>,
    mqtt: {
      connect: (opts: BambuMqttConnectOpts) =>
        ipcRenderer.invoke('bambu:mqtt:connect', opts) as Promise<{ ok: boolean; message?: string }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('bambu:mqtt:disconnect', connectionId) as Promise<boolean>,
      control: (payload: {
        connectionId: string
        action: string
        temperature?: number
        heater?: string
        percent?: number
        filename?: string
        slot?: number
        fan?: 'part' | 'chamber'
      }) => ipcRenderer.invoke('bambu:mqtt:control', payload) as Promise<boolean>,
      onStatus: (listener: (patch: BambuLivePatch) => void) => {
        const handler = (_event: IpcRendererEvent, patch: BambuLivePatch) => listener(patch)
        ipcRenderer.on('bambu:mqtt:status', handler)
        return () => ipcRenderer.removeListener('bambu:mqtt:status', handler)
      }
    },
    fetchPrintUsage: (opts: {
      host: string
      accessCode: string
      gcodeFile?: string
      filename?: string
    }) =>
      ipcRenderer.invoke('bambu:printUsage', opts) as Promise<
        | { ok: true; grams: number; source: string; path?: string }
        | { ok: false; message: string }
      >
  },
  moonrakerWs: {
    connect: (opts: { connectionId: string; baseUrl: string; apiKey?: string }) =>
      ipcRenderer.invoke('moonraker:ws:connect', opts) as Promise<{
        ok: boolean
        message?: string
        wsUrl?: string
      }>,
    disconnect: (connectionId: string) =>
      ipcRenderer.invoke('moonraker:ws:disconnect', connectionId) as Promise<boolean>,
    onEvent: (
      listener: (ev: {
        connectionId: string
        event: 'open' | 'message' | 'close'
        data?: string
        wsUrl?: string
      }) => void
    ) => {
      const handler = (
        _e: IpcRendererEvent,
        payload: {
          connectionId: string
          event: 'open' | 'message' | 'close'
          data?: string
          wsUrl?: string
        }
      ) => listener(payload)
      ipcRenderer.on('moonraker:ws:event', handler)
      return () => ipcRenderer.removeListener('moonraker:ws:event', handler)
    }
  },
  crealityNative: {
    connect: (opts: { connectionId: string; host: string }) =>
      ipcRenderer.invoke('creality:native:connect', opts) as Promise<{
        ok: boolean
        message?: string
      }>,
    disconnect: (connectionId: string) =>
      ipcRenderer.invoke('creality:native:disconnect', connectionId) as Promise<boolean>,
    onEvent: (
      listener: (ev: {
        connectionId: string
        event: 'open' | 'close' | 'status'
        state?: string
        progress?: number
        remainingSeconds?: number
        layer?: number
        layerTotal?: number
        extruder?: { actual: number; target: number }
        bed?: { actual: number; target: number }
        fanSpeed?: number
        filename?: string
        message?: string
      }) => void
    ) => {
      const handler = (_e: IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
        listener(payload)
      ipcRenderer.on('creality:native:event', handler)
      return () => ipcRenderer.removeListener('creality:native:event', handler)
    }
  },
  elegoo: {
    sdcp: {
      connect: (opts: { connectionId: string; host: string }) =>
        ipcRenderer.invoke('elegoo:sdcp:connect', opts) as Promise<{
          ok: boolean
          message?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('elegoo:sdcp:disconnect', connectionId) as Promise<boolean>,
      control: (payload: {
        connectionId: string
        action: string
        percent?: number
        fan?: 'part' | 'chamber'
      }) => ipcRenderer.invoke('elegoo:sdcp:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          chamberFanSpeed?: number
          boardTemp?: number
          chamberTemp?: number
          printSpeed?: number
          filename?: string
          message?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('elegoo:sdcp:status', handler)
        return () => ipcRenderer.removeListener('elegoo:sdcp:status', handler)
      }
    }
  },
  anycubic: {
    lan: {
      connect: (opts: { connectionId: string; host: string }) =>
        ipcRenderer.invoke('anycubic:lan:connect', opts) as Promise<{
          ok: boolean
          message?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('anycubic:lan:disconnect', connectionId) as Promise<boolean>,
      control: (payload: {
        connectionId: string
        action: string
        temperature?: number
        heater?: string
        percent?: number
      }) => ipcRenderer.invoke('anycubic:lan:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          printSpeed?: number
          filename?: string
          message?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('anycubic:lan:status', handler)
        return () => ipcRenderer.removeListener('anycubic:lan:status', handler)
      }
    },
    cloud: {
      validate: (payload: { token: string; mode: 'web' | 'slicer' }) =>
        ipcRenderer.invoke('anycubic:cloud:validate', payload) as Promise<{
          ok: boolean
          message: string
          email?: string
          userId?: string
        }>,
      listDevices: (payload: { token: string; mode: 'web' | 'slicer' }) =>
        ipcRenderer.invoke('anycubic:cloud:listDevices', payload) as Promise<{
          ok: boolean
          devices: Array<{ id: string; name: string; model?: string; online: boolean }>
          message?: string
          resolvedToken?: string
        }>,
      connect: (opts: {
        connectionId: string
        token: string
        printerId: string
        mode?: 'web' | 'slicer'
      }) =>
        ipcRenderer.invoke('anycubic:cloud:connect', opts) as Promise<{
          ok: boolean
          message?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('anycubic:cloud:disconnect', connectionId) as Promise<boolean>,
      control: (payload: { connectionId: string; action: string }) =>
        ipcRenderer.invoke('anycubic:cloud:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          printSpeed?: number
          filename?: string
          message?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('anycubic:cloud:status', handler)
        return () => ipcRenderer.removeListener('anycubic:cloud:status', handler)
      }
    }
  },
  creality: {
    cloud: {
      openLogin: (region: 'china' | 'global') =>
        ipcRenderer.invoke('creality:cloud:openLogin', region) as Promise<
          { ok: true; token: string; userId: string } | { ok: false; message: string }
        >,
      listDevices: (payload: { region: 'china' | 'global'; token: string; userId: string }) =>
        ipcRenderer.invoke('creality:cloud:listDevices', payload) as Promise<{
          ok: boolean
          devices: Array<{
            id: string
            name: string
            model?: string
            online: boolean
            host?: string
          }>
          message?: string
        }>,
      connect: (opts: {
        connectionId: string
        token: string
        userId: string
        deviceId: string
        region?: 'china' | 'global'
        host?: string
      }) =>
        ipcRenderer.invoke('creality:cloud:connect', opts) as Promise<{
          ok: boolean
          message?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('creality:cloud:disconnect', connectionId) as Promise<boolean>,
      control: (payload: { connectionId: string; action: string }) =>
        ipcRenderer.invoke('creality:cloud:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          printSpeed?: number
          filename?: string
          message?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('creality:cloud:status', handler)
        return () => ipcRenderer.removeListener('creality:cloud:status', handler)
      }
    }
  },
  flashforge: {
    lan: {
      probe: (opts: { host: string; serial: string; checkCode: string; connectionId?: string }) =>
        ipcRenderer.invoke('flashforge:lan:probe', opts) as Promise<{
          ok: boolean
          message: string
          name?: string
        }>,
      connect: (opts: {
        connectionId: string
        host: string
        serial: string
        checkCode: string
      }) =>
        ipcRenderer.invoke('flashforge:lan:connect', opts) as Promise<{
          ok: boolean
          message?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('flashforge:lan:disconnect', connectionId) as Promise<boolean>,
      control: (payload: { connectionId: string; action: string }) =>
        ipcRenderer.invoke('flashforge:lan:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          printSpeed?: number
          filename?: string
          message?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('flashforge:lan:status', handler)
        return () => ipcRenderer.removeListener('flashforge:lan:status', handler)
      }
    }
  },
  snapmaker: {
    lan: {
      probe: (opts: { host: string; token?: string; connectionId?: string }) =>
        ipcRenderer.invoke('snapmaker:lan:probe', opts) as Promise<{
          ok: boolean
          message: string
          token?: string
        }>,
      connect: (opts: { connectionId: string; host: string; token?: string }) =>
        ipcRenderer.invoke('snapmaker:lan:connect', opts) as Promise<{
          ok: boolean
          message?: string
          token?: string
        }>,
      disconnect: (connectionId: string) =>
        ipcRenderer.invoke('snapmaker:lan:disconnect', connectionId) as Promise<boolean>,
      control: (payload: { connectionId: string; action: string }) =>
        ipcRenderer.invoke('snapmaker:lan:control', payload) as Promise<boolean>,
      onStatus: (
        listener: (patch: {
          connectionId: string
          health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
          state: string
          progress: number
          remainingSeconds?: number
          layer?: number
          layerTotal?: number
          extruder?: { actual: number; target: number }
          bed?: { actual: number; target: number }
          fanSpeed?: number
          printSpeed?: number
          filename?: string
          message?: string
          token?: string
          updatedAt: string
        }) => void
      ) => {
        const handler = (_e: IpcRendererEvent, patch: Parameters<typeof listener>[0]) =>
          listener(patch)
        ipcRenderer.on('snapmaker:lan:status', handler)
        return () => ipcRenderer.removeListener('snapmaker:lan:status', handler)
      }
    }
  },
  camera: {
    discover: (opts: { brand: string; baseUrl?: string; host?: string; apiKey?: string }) =>
      ipcRenderer.invoke('camera:discover', opts) as Promise<
        Array<{
          id: string
          name: string
          streamUrl: string
          snapshotUrl?: string
          remoteStreamUrl?: string
          remoteSnapshotUrl?: string
        }>
      >,
    snapshot: (payload: { url: string; apiKey?: string }) =>
      ipcRenderer.invoke('camera:snapshot', payload) as Promise<
        { ok: true; contentType: string; base64: string } | { ok: false; message: string }
      >
  },
  discover: {
    scanLan: (opts?: {
      brands?: Array<
        | 'klipper'
        | 'bambu'
        | 'creality'
        | 'elegoo'
        | 'anycubic'
        | 'snapmaker'
        | 'flashforge'
        | 'qidi'
      >
      concurrency?: number
      timeoutMs?: number
    }) =>
      ipcRenderer.invoke('discover:lan:scan', opts) as Promise<{
        ok: boolean
        hits: Array<{
          host: string
          brand:
            | 'klipper'
            | 'bambu'
            | 'creality'
            | 'elegoo'
            | 'anycubic'
            | 'snapmaker'
            | 'flashforge'
            | 'qidi'
          port: number
          label: string
          name?: string
          baseUrl?: string
          needsCredentials?: boolean
          detail?: string
        }>
        message?: string
      }>,
    cancelLan: () => ipcRenderer.invoke('discover:lan:cancel') as Promise<boolean>,
    onLanProgress: (
      listener: (progress: {
        phase: 'scanning' | 'done' | 'cancelled' | 'error'
        scanned: number
        total: number
        found: number
        message?: string
      }) => void
    ) => {
      const handler = (_e: IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
        listener(progress)
      ipcRenderer.on('discover:lan:progress', handler)
      return () => ipcRenderer.removeListener('discover:lan:progress', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
