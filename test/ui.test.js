import test from 'node:test'
import assert from 'node:assert/strict'

import { UI } from '../public/js/ui.js'

function makeUI({ filled = true, status = 'satisfied' } = {}) {
  const puzzle = {
    title: 'Test puzzle',
    categories: [{ id: 'color' }],
    positions: { labels: ['#1'] },
    clues: [{ id: 'c1' }],
  }

  const store = {
    subscribe() {},
    session: { puzzle },
    effective: { color: filled ? [[0]] : [[0, 1]] },
  }

  const ui = new UI(store)
  ui.clueStates = new Map([['c1', { status }]])
  return ui
}

test('isSolved requires a filled grid and satisfied clues', () => {
  assert.equal(makeUI({ status: 'satisfied' }).isSolved(), true)

  for (const status of ['unknown', 'pending', 'violated']) {
    assert.equal(makeUI({ status }).isSolved(), false, status)
  }

  assert.equal(makeUI({ filled: false, status: 'satisfied' }).isSolved(), false)
})
