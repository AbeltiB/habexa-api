import { db } from './db.js'

/**
 * Records an admin mutation. Append-only — never update or delete these rows.
 * `before`/`after` should be plain JSON-serializable snapshots of the affected
 * entity (or a relevant subset), not full Prisma objects with BigInt fields —
 * stringify BigInts first if the entity carries any.
 */
export async function writeAuditLog(opts: {
  actorId: string
  action: string
  entity: string
  entityId?: string
  before?: unknown
  after?: unknown
}): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: opts.actorId,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId,
      before: opts.before === undefined ? undefined : JSON.parse(JSON.stringify(opts.before)),
      after: opts.after === undefined ? undefined : JSON.parse(JSON.stringify(opts.after)),
    },
  })
}
