export type ZoneCamera = {
  id: string
  name: string
  /** HTTP snapshot or MJPEG URL */
  url: string
  snapshotUrl?: string
}

export type MonitorZone = {
  id: string
  name: string
  cameras: ZoneCamera[]
  createdAt: string
  updatedAt?: string
}
