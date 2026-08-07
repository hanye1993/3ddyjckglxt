import { useEffect, useRef, useState } from 'react'
import { Typography } from 'antd'
import type { CameraSource } from '../../adapters/base'
import { serverGet } from '../../api/serverClient'

function remoteOf(c: CameraSource): string {
  return c.remoteSnapshotUrl || c.remoteStreamUrl || c.snapshotUrl || c.streamUrl || ''
}

/** Snapshot poll tile; clears timer on unmount (nav leave). */
export function SnapshotCam({
  cameras,
  title,
  subtitle,
  intervalMs = 1500,
  active = true
}: {
  cameras: CameraSource[]
  title: string
  subtitle?: string
  intervalMs?: number
  /** When false, stop polling (parent keeps mount but pauses) */
  active?: boolean
}) {
  const [imgSrc, setImgSrc] = useState('')
  const [phase, setPhase] = useState<'boot' | 'live' | 'fail'>('boot')
  const [err, setErr] = useState('')
  const idxRef = useRef(0)
  const failRef = useRef(0)
  const aliveRef = useRef(false)
  const camsRef = useRef(cameras)
  camsRef.current = cameras
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    idxRef.current = 0
    failRef.current = 0
    aliveRef.current = false
    setImgSrc('')
    setPhase('boot')
    setErr('')
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    if (!active || !cameras.length) return

    const pull = async () => {
      const list = camsRef.current
      if (!list.length) return
      if (idxRef.current >= list.length) idxRef.current = 0
      const cam = list[idxRef.current]
      const remote = remoteOf(cam)
      if (!remote) {
        idxRef.current += 1
        return
      }
      try {
        if (remote.startsWith('server-api:')) {
          const path = remote.slice('server-api:'.length)
          const data = await serverGet<{
            contentType?: string
            base64?: string
            message?: string
          }>(path)
          if (data.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErr('')
            setImgSrc(`data:${data.contentType || 'image/jpeg'};base64,${data.base64}`)
            return
          }
          if (data.message) setErr(data.message)
        } else {
          const res = await window.electronAPI?.camera?.snapshot({ url: remote })
          if (res?.ok && res.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErr('')
            setImgSrc(`data:${res.contentType || 'image/jpeg'};base64,${res.base64}`)
            return
          }
          if (res && 'message' in res && res.message) setErr(res.message)
        }
      } catch {
        /* ignore */
      }
      failRef.current += 1
      if (failRef.current % 2 === 0) idxRef.current += 1
      if (!aliveRef.current && failRef.current >= list.length * 3) setPhase('fail')
    }

    void pull()
    timer.current = setInterval(() => void pull(), intervalMs)
    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [cameras, intervalMs, active])


  return (
    <div className="monitor-tile">
      <div className="monitor-tile-head">
        <Typography.Text strong ellipsis style={{ maxWidth: '70%' }}>
          {title}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {phase === 'live' ? '直播' : phase === 'fail' ? '离线' : '连接中'}
          {subtitle ? ` · ${subtitle}` : ''}
        </Typography.Text>
      </div>
      <div className={`monitor-tile-frame${!imgSrc ? ' empty' : ''}`}>
        {imgSrc ? (
          <img src={imgSrc} alt={title} draggable={false} />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12, padding: 8, textAlign: 'center' }}>
            {phase === 'fail' ? err || '无法取流' : '加载画面…'}
          </Typography.Text>
        )}
      </div>
    </div>
  )
}
