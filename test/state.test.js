import test from 'node:test'
import assert from 'node:assert/strict'

import { Store, createSession, propagateGrid } from '../public/js/state.js'
import { makePuzzle } from '../test-support/fixtures.js'

function makeTestPuzzle() {
  return makePuzzle({
    categories: [
      { id: 'color', label: 'Color', values: ['Red', 'Blue', 'Green'] },
      { id: 'name', label: 'Name', values: ['Ann', 'Bob', 'Cid'] },
    ],
    clues: [{ id: 'c1', text: 'A test clue' }],
  })
}

test('createSession starts with full candidate domains', () => {
  const puzzle = makeTestPuzzle()
  const session = createSession(puzzle)

  assert.deepEqual(session.grid.color, [
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
  ])
  assert.deepEqual(session.grid.name, [
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
  ])
  assert.deepEqual(session.clues, { c1: { manual: null } })
  assert.deepEqual(session.ui, { showEliminated: false })
})

test('propagateGrid removes a filled value and cascades', () => {
  const grid = { color: [[0], [0, 1], [1, 2]] }

  assert.equal(propagateGrid(grid), true)
  assert.deepEqual(grid.color, [[0], [1], [2]])
})

test('propagateGrid reports no change when nothing is forced', () => {
  const grid = { color: [[0, 1], [0, 1]] }

  assert.equal(propagateGrid(grid), false)
  assert.deepEqual(grid.color, [[0, 1], [0, 1]])
})

test('Store.toggleCandidate is undoable and redoable', () => {
  const store = new Store(createSession(makeTestPuzzle()))

  store.toggleCandidate('color', 1, 0)
  assert.deepEqual(store.effective.color[1], [1, 2])
  assert.equal(store.canUndo(), true)

  store.undo()
  assert.deepEqual(store.effective.color[1], [0, 1, 2])
  assert.equal(store.canRedo(), true)

  store.redo()
  assert.deepEqual(store.effective.color[1], [1, 2])
})

test('Store.keepOnly blocks a value already placed elsewhere', () => {
  const store = new Store(createSession(makeTestPuzzle()))

  const first = store.keepOnly('color', 0, 0)
  assert.equal(first.blocked, false)
  assert.deepEqual(store.effective.color[0], [0])
  assert.ok(!store.effective.color[1].includes(0))

  const second = store.keepOnly('color', 1, 0)
  assert.deepEqual(second, { blocked: true, position: 0 })
})

test('Store.resetGrid restores candidates and manual marks', () => {
  const store = new Store(createSession(makeTestPuzzle()))

  store.toggleCandidate('color', 1, 0)
  store.setClueManual('c1', true)
  store.resetGrid()

  assert.deepEqual(store.session.grid.color[1], [0, 1, 2])
  assert.equal(store.session.clues.c1.manual, null)
})

test('Store.setClueManual is undoable', () => {
  const store = new Store(createSession(makeTestPuzzle()))

  store.setClueManual('c1', true)
  assert.equal(store.session.clues.c1.manual, true)

  store.undo()
  assert.equal(store.session.clues.c1.manual, null)
})

test('Store.setClueConstraints updates the puzzle constraint', () => {
  const store = new Store(createSession(makeTestPuzzle()))
  const constraints = [{ type: 'at', subject: 'color:Red', positions: 'first' }]

  store.setClueConstraints('c1', constraints)
  assert.deepEqual(store.session.puzzle.clues[0].constraints, constraints)
})
