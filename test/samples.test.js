import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { parsePuzzle } from '../public/js/schema.js'
import { createSession } from '../public/js/state.js'
import { evaluateClue } from '../public/js/clues.js'

const EXPECTED = {
  tiny: { positions: 4, categories: 1, clues: 4 },
  passengers: { positions: 4, categories: 4, clues: 11 },
  librarians: { positions: 5, categories: 6, clues: 22 },
  neighbors: { positions: 5, categories: 6, clues: 22 },
  houses: { positions: 5, categories: 6, clues: 25 },
}

async function loadSample(name) {
  const raw = await readFile(new URL(`../samples/${name}.json`, import.meta.url), 'utf8')
  return parsePuzzle(JSON.parse(raw))
}

test('bundled samples parse and match their documented shape', async () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const puzzle = await loadSample(name)

    assert.equal(puzzle.positions.labels.length, expected.positions, `${name}: positions`)
    assert.equal(puzzle.categories.length, expected.categories, `${name}: categories`)
    assert.equal(puzzle.clues.length, expected.clues, `${name}: clues`)
  }
})

test('every clue in the bundled samples is valid at the initial grid', async () => {
  for (const name of Object.keys(EXPECTED)) {
    const puzzle = await loadSample(name)
    const session = createSession(puzzle)

    for (const clue of puzzle.clues) {
      const state = evaluateClue(clue, puzzle, session.grid)
      assert.equal(state.status, 'pending', `${name}: ${clue.text}`)
    }
  }
})

test('the Tiny sample is solved by its known solution', async () => {
  const puzzle = await loadSample('tiny')
  const grid = { color: [[0], [1], [2], [3]] }

  for (const clue of puzzle.clues) {
    assert.equal(evaluateClue(clue, puzzle, grid).status, 'satisfied', clue.text)
  }
})
