import { describe, it, expect, beforeEach, vi } from 'vitest'
import { showToast, dismissToast, currentToast, subscribeToast, resetToast } from './toast'

beforeEach(() => {
  resetToast()
})

describe('the toast store', () => {
  it('starts empty', () => {
    expect(currentToast()).toBeNull()
  })

  it('holds the message and clears on dismiss', () => {
    showToast('Filled.')
    expect(currentToast()?.message).toBe('Filled.')
    dismissToast()
    expect(currentToast()).toBeNull()
  })

  it('notifies subscribers, which is what re-renders the component', () => {
    // Driving the same listener set the hook subscribes to: a store that held
    // the right value but never emitted would show nothing and pass a
    // value-only assertion.
    let calls = 0
    const unsub = subscribeToast(() => { calls++ })

    showToast('Filled.')
    expect(calls).toBe(1)

    dismissToast()
    expect(calls).toBe(2)

    // Dismissing an already-empty store is a no-op, not a spurious render.
    dismissToast()
    expect(calls).toBe(2)

    unsub()
    showToast('nobody listening')
    expect(calls).toBe(2)
  })

  it('replaces the showing toast rather than queueing behind it', () => {
    // These confirm something the user just did, so the newest is the only one
    // still true — a queue would surface stale messages after the fact.
    showToast('first')
    showToast('second')
    expect(currentToast()?.message).toBe('second')
    dismissToast()
    expect(currentToast()).toBeNull()
  })

  it('carries an optional action', () => {
    const onClick = vi.fn()
    showToast('Recorded 250 to Cash.', { label: 'Undo', onClick })
    expect(currentToast()?.action?.label).toBe('Undo')
    currentToast()?.action?.onClick()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('drops a previous action when the replacement has none', () => {
    // Otherwise an Undo button would linger over an unrelated message and undo
    // something the user is no longer looking at.
    showToast('Recorded.', { label: 'Undo', onClick: vi.fn() })
    showToast('Filled.')
    expect(currentToast()?.action).toBeUndefined()
  })
})
