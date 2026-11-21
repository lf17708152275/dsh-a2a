/**
 * Dashboard task table: the snapshot returns `TaskRecord` (`taskId` /
 * `state` / `skill` / `serverId`), not the A2A wire `Task` (`id` /
 * `status.state`). This locks the mapping so the ID and state columns cannot
 * silently go blank again.
 * @module dsh-a2a/tests/unit/task-row.spec
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TaskRecord } from '../../src/server/store.ts'
import type { TaskRecordView } from '../../src/client/task-row.ts'
import { taskRowOf } from '../../src/client/task-row.ts'

describe('taskRowOf', () => {
  it('accepts the server TaskRecord shape', () => {
    expectTypeOf<TaskRecord>().toMatchTypeOf<TaskRecordView>()
  })

  it('maps the dashboard TaskRecord fields', () => {
    expect(taskRowOf({
      taskId: 'a2a-1',
      contextId: 'ctx-1',
      skill: 'chat',
      state: 'TASK_STATE_COMPLETED',
      serverId: 'reports',
    })).toEqual({
      id: 'a2a-1',
      skill: 'chat',
      serverId: 'reports',
      state: 'TASK_STATE_COMPLETED',
    })
  })

  it('falls back to dashes instead of undefined', () => {
    expect(taskRowOf({ taskId: 'a2a-2' })).toEqual({
      id: 'a2a-2',
      skill: '-',
      serverId: '-',
      state: '-',
    })
  })
})
