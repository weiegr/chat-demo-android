import { createId } from '../../utils/id.js'
import { abortTransaction, getDB, hasPersistentStorage, notifyMemoryChange } from './db.js'
import {
  defaultMemorySource,
  emptyMemoryProfile,
  getMemoryMessages,
  getMemoryRounds,
  isMemorySession,
  isMemorySourceAllowed,
  type MemoryProfile,
  type MemorySource,
  type MemoryTurn,
} from './memoryModel.js'
import type { Session, SessionMemoryState } from './types.js'

const memoryStores = ['globalMemory', 'memorySources', 'sessions'] as const

export const loadMemoryProfile = async () =>
  (await (await getDB()).get('globalMemory', 'profile')) ?? emptyMemoryProfile

export const updateMemorySettings = async (change: { enabled: boolean } | 'delete') => {
  const tx = (await getDB()).transaction(['globalMemory', 'memorySources'], 'readwrite')
  const settings = tx.objectStore('globalMemory')
  const [next] = await Promise.all([
    (async () => {
      try {
        const current = (await settings.get('profile')) ?? emptyMemoryProfile
        if (change !== 'delete' && change.enabled === current.enabled) {
          return current
        }
        const profile: MemoryProfile = {
          ...current,
          epoch: current.epoch + 1,
          lease: undefined,
          ...(change === 'delete'
            ? {
                markdown: '',
                updatedAt: undefined,
                lastUsage: undefined,
              }
            : change),
        }
        if (change === 'delete') {
          const sources = tx.objectStore('memorySources')
          const optedOut = (await sources.getAll()).filter(({ enabled }) => !enabled)
          await sources.clear()
          await Promise.all(
            optedOut.map(({ id, revision }) =>
              sources.put({ ...defaultMemorySource(id), enabled: false, revision: revision + 1 })
            )
          )
        }
        await settings.put(profile)
        return profile
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  notifyMemoryChange('profile')
  return next
}

export const loadSessionMemory = async (sessionId: string) =>
  (await (await getDB()).get('memorySources', sessionId)) ?? defaultMemorySource(sessionId)

export const listSessionMemoryStates = async (): Promise<Map<string, SessionMemoryState>> =>
  new Map(
    (await (await getDB()).getAll('memorySources')).map(({ id, enabled, active, processed }) => [
      id,
      { enabled, active, processed },
    ])
  )

export const setSessionMemoryEnabled = async (sessionId: string, enabled: boolean) => {
  const tx = (await getDB()).transaction(memoryStores, 'readwrite')
  const sources = tx.objectStore('memorySources')
  let changed = false
  const [current] = await Promise.all([
    (async () => {
      try {
        const session = await tx.objectStore('sessions').get(sessionId)
        if (!session || !isMemorySession(session)) {
          throw new Error('Memory session unavailable')
        }
        const source = (await sources.get(sessionId)) ?? defaultMemorySource(sessionId)
        if (enabled === source.enabled) {
          return source
        }
        const next: MemorySource = {
          id: sessionId,
          enabled,
          active: source.active,
          processed: source.processed,
          revision: source.revision + 1,
          publicId: enabled && source.active ? createId() : undefined,
        }
        await sources.put(next)
        changed = true
        return next
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  if (changed) {
    notifyMemoryChange('sources', sessionId)
  }
  return current
}

export const listMemorySources = async (profile: MemoryProfile) =>
  (await (await getDB()).getAll('memorySources')).filter((source) =>
    isMemorySourceAllowed(profile, source)
  )

export const hasMemorySources = async (profile: MemoryProfile, excludeId?: string) => {
  if (!profile.enabled) {
    return false
  }
  const database = await getDB()
  if (!(await hasPersistentStorage())) {
    return (await listMemorySources(profile)).some(({ id }) => id !== excludeId)
  }
  const tx = database.transaction('memorySources', 'readonly')
  const [count, excluded] = await Promise.all([
    tx.store.index('publicId').count(),
    excludeId === undefined ? undefined : tx.store.get(excludeId),
  ])
  await tx.done
  return count > Number(Boolean(excluded && isMemorySourceAllowed(profile, excluded)))
}

export type AuthorizedSession = { session: Session; source: MemorySource & { publicId: string } }

export const readMemorySessions = async (
  ids: readonly string[],
  epoch: number
): Promise<AuthorizedSession[]> => {
  const tx = (await getDB()).transaction(memoryStores, 'readonly')
  const profile = await tx.objectStore('globalMemory').get('profile')
  const found =
    profile?.enabled && profile.epoch === epoch
      ? await Promise.all(
          ids.map(async (id): Promise<AuthorizedSession | null> => {
            const source = await tx.objectStore('memorySources').get(id)
            if (!source || !isMemorySourceAllowed(profile, source)) {
              return null
            }
            const session = await tx.objectStore('sessions').get(id)
            return session && isMemorySession(session) ? { session, source } : null
          })
        )
      : []
  await tx.done
  return found.filter((entry) => entry !== null)
}

export async function* readMemorySessionBatches(profile: MemoryProfile) {
  const ids = (await listMemorySources(profile)).map(({ id }) => id)
  for (let offset = 0; offset < ids.length; offset += 128) {
    yield await readMemorySessions(ids.slice(offset, offset + 128), profile.epoch)
  }
}

export const nextMemorySource = async () => {
  const database = await getDB()
  if (await hasPersistentStorage()) {
    const tx = database.transaction('memorySources', 'readonly')
    const source = (await tx.store.index('dueAt').openCursor())?.value
    await tx.done
    return source
  }
  return (await database.getAll('memorySources'))
    .filter(({ dueAt }) => dueAt !== undefined)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))[0]
}

type MemoryClaim = { id: string; profile: MemoryProfile }

export const claimMemoryWork = async (epoch: number): Promise<MemoryClaim | null> => {
  const tx = (await getDB()).transaction('globalMemory', 'readwrite')
  const profile = await tx.store.get('profile')
  if (
    !profile?.enabled ||
    profile.epoch !== epoch ||
    (profile.lease && profile.lease.expires > Date.now())
  ) {
    await tx.done
    return null
  }
  const id = createId()
  await Promise.all([
    tx.store.put({ ...profile, lease: { id, expires: Date.now() + 100_000 } }),
    tx.done,
  ])
  return { id, profile }
}

export type MemorySourceVersion = { id: string; publicId: string; messageIds: readonly string[] }

export type MemoryGenerationResult = { markdown?: string; usage: MemoryProfile['lastUsage'] }

type WorkResult = {
  generated?: MemoryGenerationResult
  auto?: {
    sourceId: string
    publicId?: string
    turns: MemoryTurn[]
    used: MemoryTurn[]
    failure?: 'retry' | 'pause'
  }
  rebuild?: readonly MemorySourceVersion[]
}

/** Release the claim and publish only while the same authorized source text is current. */
export const finishMemoryWork = async (claim: MemoryClaim, result: WorkResult = {}) => {
  const tx = (await getDB()).transaction(memoryStores, 'readwrite')
  const settings = tx.objectStore('globalMemory')
  const sources = tx.objectStore('memorySources')
  const sessions = tx.objectStore('sessions')
  let published = false
  await Promise.all([
    (async () => {
      try {
        const profile = await settings.get('profile')
        if (profile?.lease?.id !== claim.id) {
          return
        }
        let valid = profile.enabled && profile.epoch === claim.profile.epoch
        if (valid && result.auto) {
          const { sourceId, publicId, turns, used, failure } = result.auto
          const [source, session] = await Promise.all([
            sources.get(sourceId),
            sessions.get(sourceId),
          ])
          const authorized =
            source && isMemorySourceAllowed(profile, source) && source.publicId === publicId
          valid = Boolean(authorized && session && isMemorySession(session))
          if (authorized && source && session && valid) {
            const rounds = getMemoryRounds(session)
            const pending = source.pending ?? []
            const sameTurn = (a: MemoryTurn, b: MemoryTurn) =>
              a.questionId === b.questionId &&
              a.replyId === b.replyId &&
              a.epoch === b.epoch &&
              a.sourceRevision === b.sourceRevision
            valid &&= used.every(
              (turn) =>
                pending.some((item) => sameTurn(turn, item)) &&
                rounds.get(turn.questionId)?.[1].id === turn.replyId
            )
            const processed = valid && !failure ? used.map(({ questionId }) => questionId) : []
            const remaining = pending.filter(
              (item) =>
                !turns.some((turn) => sameTurn(turn, item)) ||
                ((failure || !valid) && rounds.get(item.questionId)?.[1].id === item.replyId)
            )
            const attempts =
              failure === 'pause' ? 2 : failure === 'retry' ? (source.attempts ?? 0) + 1 : 0
            await sources.put({
              ...source,
              pending: remaining,
              processed: [...new Set([...(source.processed ?? []), ...processed])],
              ...(remaining.length > 0 && attempts < 2
                ? { dueAt: failure ? Date.now() + 60_000 : source.dueAt, attempts }
                : { dueAt: undefined, attempts }),
            })
          } else if (authorized && source) {
            await sources.put({ ...source, dueAt: undefined, pending: [] })
          }
        }
        if (valid && result.rebuild) {
          const covered: MemorySource[] = []
          for (const item of result.rebuild) {
            const [source, session] = await Promise.all([
              sources.get(item.id),
              sessions.get(item.id),
            ])
            if (
              !source ||
              source.publicId !== item.publicId ||
              !isMemorySourceAllowed(profile, source) ||
              !session ||
              !isMemorySession(session)
            ) {
              valid = false
              break
            }
            const tail = getMemoryMessages(session).slice(-item.messageIds.length)
            if (
              tail.length !== item.messageIds.length ||
              tail.some((message, index) => message.id !== item.messageIds[index])
            ) {
              valid = false
              break
            }
            const included = new Set(item.messageIds)
            const processed = source.pending?.filter(
              ({ questionId, replyId }) => included.has(questionId) && included.has(replyId)
            )
            if (processed?.length) {
              const remaining = source.pending?.filter((turn) => !processed.includes(turn)) ?? []
              covered.push({
                ...source,
                pending: remaining,
                processed: [
                  ...new Set([
                    ...(source.processed ?? []),
                    ...processed.map(({ questionId }) => questionId),
                  ]),
                ],
                dueAt: remaining.length ? source.dueAt : undefined,
              })
            }
          }
          if (valid && result.generated?.markdown) {
            await Promise.all(covered.map((source) => sources.put(source)))
          }
        }
        const generated = valid ? result.generated : undefined
        published = Boolean(generated)
        await settings.put({
          ...profile,
          lease: undefined,
          ...(generated ? { lastUsage: generated.usage } : {}),
          ...(generated?.markdown !== undefined
            ? { markdown: generated.markdown, updatedAt: Date.now() }
            : {}),
        })
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  notifyMemoryChange('profile')
  return published
}
