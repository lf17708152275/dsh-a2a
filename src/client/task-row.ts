/**
 * Map a dashboard snapshot task (`TaskRecord`) to the fields the task table
 * renders. The snapshot returns the store shape (`taskId` / `state` / `skill`),
 * not the A2A wire `Task` (`id` / `status.state`); mixing the two leaves the
 * table's ID and state columns empty.
 * @module dsh-a2a/client/task-row
 */

/** The subset of `TaskRecord` the dashboard snapshot exposes and the table uses. */
export interface TaskRecordView {
  readonly taskId: string
  readonly contextId?: string
  readonly skill?: string
  readonly state?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly serverId?: string
  readonly error?: { readonly code: string; readonly message: string }
  readonly statusText?: string
}

/** One rendered task-table row. */
export interface TaskRow {
  readonly id: string
  readonly skill: string
  readonly serverId: string
  readonly state: string
}

/** Project a `TaskRecord` onto the task table's columns. */
export function taskRowOf(record: TaskRecordView): TaskRow {
  return {
    id: record.taskId,
    skill: record.skill ?? '-',
    serverId: record.serverId ?? '-',
    state: record.state ?? '-',
  }
}
