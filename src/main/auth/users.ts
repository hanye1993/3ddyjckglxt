import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  defaultPermissions,
  type AuthUserPublic,
  type AuthUserRecord,
  type DeviceAcl,
  type UserLevel
} from '../../shared/permissions'
import { normalizeUserSsoBinding, type SsoProviderId } from '../../shared/sso'
import { hashPassword, verifyPassword } from './jwt'

export type UsersFile = {
  jwtSecret: string
  users: AuthUserRecord[]
}

function migrateUser(u: AuthUserRecord): AuthUserRecord {
  const bind = normalizeUserSsoBinding(u)
  return {
    ...u,
    ssoProvider: bind.ssoProvider,
    ssoExternalId: bind.ssoExternalId,
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    deviceAcl: u.deviceAcl && typeof u.deviceAcl === 'object' ? u.deviceAcl : {}
  }
}

function publicUser(u: AuthUserRecord): AuthUserPublic {
  const { passwordHash: _h, passwordSalt: _s, ...rest } = migrateUser(u)
  return rest
}

export class UserStore {
  private path: string
  private data: UsersFile
  private fileMtimeMs = 0

  constructor(dataRoot: string, jwtSecretFallback: string) {
    this.path = join(dataRoot, 'users.json')
    this.data = this.load(jwtSecretFallback)
    this.touchMtime()
  }

  private touchMtime(): void {
    try {
      if (existsSync(this.path)) {
        this.fileMtimeMs = statSync(this.path).mtimeMs
      }
    } catch {
      this.fileMtimeMs = 0
    }
  }

  /** Reload if another process / HMR instance wrote users.json */
  reloadFromDiskIfNeeded(): void {
    try {
      if (!existsSync(this.path)) return
      const mtime = statSync(this.path).mtimeMs
      if (mtime <= this.fileMtimeMs) return
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as UsersFile
      if (raw && Array.isArray(raw.users) && typeof raw.jwtSecret === 'string' && raw.jwtSecret) {
        raw.users = raw.users.map((u) => migrateUser(u))
        this.data = raw
        this.fileMtimeMs = mtime
      }
    } catch {
      /* keep memory */
    }
  }

  private load(jwtSecretFallback: string): UsersFile {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8')) as UsersFile
        if (raw && Array.isArray(raw.users) && typeof raw.jwtSecret === 'string' && raw.jwtSecret) {
          raw.users = raw.users.map((u) => migrateUser(u))
          return raw
        }
      }
    } catch {
      /* recreate */
    }
    const { hash, salt } = hashPassword('admin123')
    const now = new Date().toISOString()
    const admin: AuthUserRecord = {
      id: randomUUID(),
      username: 'admin',
      displayName: '管理员',
      level: 'admin',
      enabled: true,
      permissions: defaultPermissions('admin'),
      deviceAcl: {},
      ssoProvider: 'none',
      ssoExternalId: '',
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: now,
      updatedAt: now
    }
    const data: UsersFile = { jwtSecret: jwtSecretFallback, users: [admin] }
    this.persist(data)
    return data
  }

  private persist(data: UsersFile = this.data): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf8')
    this.data = data
    this.touchMtime()
  }

  getJwtSecret(): string {
    this.reloadFromDiskIfNeeded()
    return this.data.jwtSecret
  }

  list(): AuthUserPublic[] {
    this.reloadFromDiskIfNeeded()
    return this.data.users.map(publicUser)
  }

  getById(id: string): AuthUserRecord | undefined {
    this.reloadFromDiskIfNeeded()
    const u = this.data.users.find((x) => x.id === id)
    return u ? migrateUser(u) : undefined
  }

  getByUsername(username: string): AuthUserRecord | undefined {
    this.reloadFromDiskIfNeeded()
    const name = username.trim().toLowerCase()
    const u = this.data.users.find((x) => x.username.toLowerCase() === name)
    return u ? migrateUser(u) : undefined
  }

  getBySso(provider: SsoProviderId, externalId: string): AuthUserRecord | undefined {
    this.reloadFromDiskIfNeeded()
    const id = externalId.trim()
    if (!id) return undefined
    const u = this.data.users.find(
      (x) => migrateUser(x).ssoProvider === provider && x.ssoExternalId === id
    )
    return u ? migrateUser(u) : undefined
  }

  authenticate(username: string, password: string): AuthUserRecord | null {
    this.reloadFromDiskIfNeeded()
    const u = this.getByUsername(username)
    if (!u || !u.enabled) return null
    if (!verifyPassword(password, u.passwordHash, u.passwordSalt)) return null
    return u
  }

  create(input: {
    username: string
    password: string
    displayName?: string
    level: UserLevel
    permissions?: string[]
    deviceAcl?: DeviceAcl
    ssoProvider?: SsoProviderId | 'none'
    ssoExternalId?: string
  }): AuthUserPublic {
    this.reloadFromDiskIfNeeded()
    const username = input.username.trim()
    if (!username) throw new Error('用户名不能为空')
    if (this.getByUsername(username)) throw new Error('用户名已存在')
    if (!input.password || input.password.length < 4) throw new Error('密码至少 4 位')
    const bind = normalizeUserSsoBinding({
      ssoProvider: input.ssoProvider,
      ssoExternalId: input.ssoExternalId
    })
    if (bind.ssoProvider !== 'none') {
      if (!bind.ssoExternalId) throw new Error('请填写对接账号 / 外部 ID')
      const clash = this.getBySso(bind.ssoProvider, bind.ssoExternalId)
      if (clash) throw new Error('该对接账号已被其他用户绑定')
    }
    const { hash, salt } = hashPassword(input.password)
    const now = new Date().toISOString()
    const level = input.level
    const user: AuthUserRecord = {
      id: randomUUID(),
      username,
      displayName: (input.displayName || username).trim(),
      level,
      enabled: true,
      permissions: input.permissions ?? defaultPermissions(level),
      deviceAcl: input.deviceAcl || {},
      ssoProvider: bind.ssoProvider,
      ssoExternalId: bind.ssoExternalId,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: now,
      updatedAt: now
    }
    this.data.users.push(user)
    this.persist()
    return publicUser(user)
  }

  update(
    id: string,
    patch: Partial<{
      displayName: string
      level: UserLevel
      enabled: boolean
      permissions: string[]
      deviceAcl: DeviceAcl
      password: string
      ssoProvider: SsoProviderId | 'none'
      ssoExternalId: string
    }>
  ): AuthUserPublic {
    this.reloadFromDiskIfNeeded()
    const idx = this.data.users.findIndex((x) => x.id === id)
    if (idx < 0) throw new Error('用户不存在')
    // Mutate the stored record (not a migrated copy) so password fields stay intact
    const u = migrateUser(this.data.users[idx]!)
    if (typeof patch.displayName === 'string') u.displayName = patch.displayName.trim() || u.displayName
    if (patch.level) {
      u.level = patch.level
      if (!patch.permissions) u.permissions = defaultPermissions(patch.level)
    }
    if (typeof patch.enabled === 'boolean') {
      if (u.level === 'admin' && !patch.enabled) {
        const admins = this.data.users.filter((x) => x.level === 'admin' && x.enabled && x.id !== id)
        if (admins.length === 0) throw new Error('不能禁用最后一个管理员')
      }
      u.enabled = patch.enabled
    }
    if (Array.isArray(patch.permissions)) u.permissions = patch.permissions
    if (patch.deviceAcl && typeof patch.deviceAcl === 'object') u.deviceAcl = patch.deviceAcl
    if (patch.ssoProvider !== undefined || patch.ssoExternalId !== undefined) {
      const bind = normalizeUserSsoBinding({
        ssoProvider: patch.ssoProvider !== undefined ? patch.ssoProvider : u.ssoProvider,
        ssoExternalId: patch.ssoExternalId !== undefined ? patch.ssoExternalId : u.ssoExternalId
      })
      if (bind.ssoProvider !== 'none') {
        if (!bind.ssoExternalId) throw new Error('请填写对接账号 / 外部 ID')
        const clash = this.getBySso(bind.ssoProvider, bind.ssoExternalId)
        if (clash && clash.id !== id) throw new Error('该对接账号已被其他用户绑定')
      }
      u.ssoProvider = bind.ssoProvider
      u.ssoExternalId = bind.ssoExternalId
    }
    if (typeof patch.password === 'string' && patch.password.length > 0) {
      if (patch.password.length < 4) throw new Error('密码至少 4 位')
      const { hash, salt } = hashPassword(patch.password)
      u.passwordHash = hash
      u.passwordSalt = salt
    }
    u.updatedAt = new Date().toISOString()
    this.data.users[idx] = u
    this.persist()
    return publicUser(u)
  }

  remove(id: string): void {
    this.reloadFromDiskIfNeeded()
    const u = this.getById(id)
    if (!u) throw new Error('用户不存在')
    if (u.level === 'admin') {
      const admins = this.data.users.filter((x) => x.level === 'admin' && x.id !== id)
      if (admins.length === 0) throw new Error('不能删除最后一个管理员')
    }
    this.data.users = this.data.users.filter((x) => x.id !== id)
    this.persist()
  }

  toPublic(u: AuthUserRecord): AuthUserPublic {
    return publicUser(u)
  }
}
