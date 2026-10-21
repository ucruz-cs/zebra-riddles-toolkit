import test from 'node:test'
import assert from 'node:assert/strict'

import { PuzzleError, parsePuzzle, slugify } from '../public/js/schema.js'

test('parsePuzzle normalizes a minimal puzzle', () => {
  const puzzle = parsePuzzle({
    categories: [
      { label: 'Colour', values: ['Red', 'Blue'] },
      { label: 'Name', values: ['Ann', 'Bob'] },
    ],
  })

  assert.equal(puzzle.version, 1)
  assert.equal(puzzle.title, 'Untitled puzzle')
  assert.equal(puzzle.positions.label, 'Position')
  assert.deepEqual(puzzle.positions.labels, ['#1', '#2'])
  assert.deepEqual(
    puzzle.categories.map((category) => category.id),
    ['colour', 'name'],
  )
  assert.deepEqual(puzzle.clues, [])
})

test('parsePuzzle accepts aliases and explicit position labels', () => {
  const puzzle = parsePuzzle({
    title: '  Library  ',
    positions: { label: 'Shelf', labels: ['A', 'B'] },
    categories: [
      { name: 'Genre', options: ['Drama', 'Comedy'] },
      { id: 'Author', label: 'Author', values: ['Ann', 'Bob'] },
    ],
    clues: [
      {
        text: 'Ann is Drama',
        entities: [' author:Ann '],
        constraint: { type: 'same', a: 'author:Ann', b: 'genre:Drama' },
      },
    ],
  })

  assert.equal(puzzle.title, 'Library')
  assert.equal(puzzle.positions.label, 'Shelf')
  assert.deepEqual(puzzle.positions.labels, ['A', 'B'])
  assert.equal(puzzle.categories[0].id, 'genre')
  assert.equal(puzzle.categories[1].id, 'Author')
  assert.deepEqual(puzzle.clues[0].entities, ['author:Ann'])
  assert.deepEqual(puzzle.clues[0].constraints, [
    { type: 'same', a: 'author:Ann', b: 'genre:Drama' },
  ])
})

test('parsePuzzle accepts a positions array', () => {
  const puzzle = parsePuzzle({
    positions: ['One', 'Two'],
    categories: [{ label: 'Colour', values: ['Red', 'Blue'] }],
  })

  assert.deepEqual(puzzle.positions.labels, ['One', 'Two'])
})

test('parsePuzzle generates unique category and clue ids', () => {
  const puzzle = parsePuzzle({
    categories: [
      { id: 'same', label: 'One', values: ['A', 'B'] },
      { id: 'same', label: 'Two', values: ['C', 'D'] },
    ],
    clues: [
      { id: 'c1', text: 'First clue' },
      { id: 'c1', text: 'Second clue' },
    ],
  })

  assert.deepEqual(
    puzzle.categories.map((category) => category.id),
    ['same', 'same-2'],
  )
  assert.deepEqual(
    puzzle.clues.map((clue) => clue.id),
    ['c1', 'c1-2'],
  )
})

test('slugify creates predictable ids', () => {
  assert.equal(slugify('  Hello World!  '), 'hello-world')
  assert.equal(slugify('Éléphant & co.'), 'elephant-co')
})

test('parsePuzzle reports mismatched category value counts', () => {
  assert.throws(
    () =>
      parsePuzzle({
        categories: [
          { label: 'First', values: ['A', 'B'] },
          { label: 'Second', values: ['C', 'D', 'E'] },
        ],
      }),
    (error) =>
      error instanceof PuzzleError &&
      error.errors.some((message) => message.includes('same number of values')),
  )
})

test('parsePuzzle reports duplicate values case-insensitively', () => {
  assert.throws(
    () =>
      parsePuzzle({
        categories: [{ label: 'Colour', values: ['Red', 'red'] }],
      }),
    (error) =>
      error instanceof PuzzleError &&
      error.errors.some((message) => message.includes('duplicate value')),
  )
})

test('parsePuzzle reports a labels/count mismatch', () => {
  assert.throws(
    () =>
      parsePuzzle({
        positions: { labels: ['Only one'] },
        categories: [{ label: 'Colour', values: ['Red', 'Blue'] }],
      }),
    (error) =>
      error instanceof PuzzleError &&
      error.errors.some((message) => message.includes('at least 2 positions')),
  )
})

test('parsePuzzle reports missing clue text', () => {
  assert.throws(
    () =>
      parsePuzzle({
        categories: [{ label: 'Colour', values: ['Red', 'Blue'] }],
        clues: [{ text: '   ' }],
      }),
    (error) =>
      error instanceof PuzzleError &&
      error.errors.some((message) => message.includes('missing "text"')),
  )
})

test('parsePuzzle rejects non-object input', () => {
  assert.throws(
    () => parsePuzzle(null),
    (error) => error instanceof PuzzleError && error.errors[0].includes('JSON object'),
  )
})
