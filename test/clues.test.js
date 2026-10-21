import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canonicalType,
  describeConstraint,
  evaluateClue,
  evaluateConstraint,
  findValueLinks,
  positionSet,
  resolveRef,
} from '../public/js/clues.js'
import { emptyGrid, makePuzzle, placeValue, restrictValue } from '../test-support/fixtures.js'

function makeTestPuzzle() {
  return makePuzzle({
    categories: [
      { id: 'color', label: 'Color', values: ['Red', 'Blue', 'Green'] },
      { id: 'name', label: 'Name', values: ['Ann', 'Bob', 'Cid'] },
      { id: 'age', label: 'Age', values: ['30 years', '40 years', '50 years'] },
    ],
  })
}

function withPlaces(places) {
  const puzzle = makeTestPuzzle()
  const grid = emptyGrid(puzzle)
  for (const [categoryId, valueIndex, position] of places) {
    placeValue(grid, categoryId, valueIndex, position)
  }
  return { puzzle, grid }
}

function status(grid, constraint, puzzle) {
  return evaluateConstraint(constraint, puzzle, grid).status
}

test('resolveRef is case-insensitive and resolves superlatives', () => {
  const puzzle = makeTestPuzzle()
  const grid = emptyGrid(puzzle)
  placeValue(grid, 'color', 0, 1)
  placeValue(grid, 'age', 2, 0)

  assert.deepEqual(resolveRef(puzzle, grid, 'COLOR:red').positions, [2])
  assert.equal(resolveRef(puzzle, grid, 'age:max').index, 2)
  assert.deepEqual(resolveRef(puzzle, grid, 'age:max').positions, [1])
  assert.equal(resolveRef(puzzle, grid, 'age:min').index, 0)

  assert.match(resolveRef(puzzle, grid, 'nope:Red').error, /Unknown category/)
  assert.match(resolveRef(puzzle, grid, 'color:Orange').error, /Unknown value/)
  assert.match(resolveRef(puzzle, grid, 'color').error, /must look like/)
})

test('positionSet supports all documented position specifiers', () => {
  assert.deepEqual([...positionSet('ends', 5)], [1, 5])
  assert.deepEqual([...positionSet('first', 5)], [1])
  assert.deepEqual([...positionSet('last', 5)], [5])
  assert.deepEqual([...positionSet('middle', 4)], [2, 3])
  assert.deepEqual([...positionSet('middle', 5)], [3])
  assert.deepEqual([...positionSet(2, 5)], [2])
  assert.deepEqual([...positionSet([1, 4], 5)], [1, 4])
  assert.deepEqual([...positionSet([1, 9], 5)], [1])
  assert.deepEqual([...positionSet('', 5)], [])
})

test('canonicalType normalizes supported aliases', () => {
  assert.equal(canonicalType('immediately before'), 'immediatelyBefore')
  assert.equal(canonicalType('adjacent'), 'nextTo')
  assert.equal(canonicalType('somewhere_right_of'), 'rightOf')
  assert.equal(canonicalType('not-a-predicate'), null)
})

test('at constraints evaluate satisfied, pending and violated', () => {
  const { puzzle, grid } = withPlaces([['color', 0, 0]])

  assert.equal(
    status(grid, { type: 'at', subject: 'color:Red', positions: 'first' }, puzzle),
    'satisfied',
  )
  assert.equal(
    status(grid, { type: 'at', subject: 'color:Red', positions: 'last' }, puzzle),
    'violated',
  )
  assert.equal(
    status(grid, { type: 'at', subject: 'color:Red', positions: 'ends' }, puzzle),
    'satisfied',
  )

  const pendingGrid = emptyGrid(puzzle)
  restrictValue(pendingGrid, 'color', 0, [0, 1])
  assert.equal(
    status(pendingGrid, { type: 'at', subject: 'color:Red', positions: 'first' }, puzzle),
    'pending',
  )

  const middlePlaced = withPlaces([['color', 0, 1]])
  assert.equal(
    status(middlePlaced.grid, { type: 'at', subject: 'color:Red', positions: 'middle' }, puzzle),
    'satisfied',
  )
})

test('binary predicates evaluate satisfied, pending and violated', () => {
  const same = { type: 'same', a: 'name:Ann', b: 'color:Red' }
  const nextTo = { type: 'nextTo', a: 'name:Ann', b: 'color:Red' }
  const before = { type: 'immediatelyBefore', a: 'name:Ann', b: 'color:Red' }
  const after = { type: 'immediatelyAfter', a: 'name:Ann', b: 'color:Red' }
  const leftOf = { type: 'leftOf', a: 'name:Ann', b: 'color:Red' }
  const rightOf = { type: 'rightOf', a: 'name:Ann', b: 'color:Red' }

  const samePlace = withPlaces([
    ['name', 0, 0],
    ['color', 0, 0],
  ])
  assert.equal(status(samePlace.grid, same, samePlace.puzzle), 'satisfied')
  assert.equal(status(samePlace.grid, nextTo, samePlace.puzzle), 'violated')
  assert.equal(status(samePlace.grid, before, samePlace.puzzle), 'violated')
  assert.equal(status(samePlace.grid, after, samePlace.puzzle), 'violated')
  assert.equal(status(samePlace.grid, leftOf, samePlace.puzzle), 'violated')
  assert.equal(status(samePlace.grid, rightOf, samePlace.puzzle), 'violated')

  const leftThenRight = withPlaces([
    ['name', 0, 0],
    ['color', 0, 1],
  ])
  assert.equal(status(leftThenRight.grid, same, leftThenRight.puzzle), 'violated')
  assert.equal(status(leftThenRight.grid, nextTo, leftThenRight.puzzle), 'satisfied')
  assert.equal(status(leftThenRight.grid, before, leftThenRight.puzzle), 'satisfied')
  assert.equal(status(leftThenRight.grid, after, leftThenRight.puzzle), 'violated')
  assert.equal(status(leftThenRight.grid, leftOf, leftThenRight.puzzle), 'satisfied')
  assert.equal(status(leftThenRight.grid, rightOf, leftThenRight.puzzle), 'violated')

  const rightThenLeft = withPlaces([
    ['name', 0, 1],
    ['color', 0, 0],
  ])
  assert.equal(status(rightThenLeft.grid, before, rightThenLeft.puzzle), 'violated')
  assert.equal(status(rightThenLeft.grid, after, rightThenLeft.puzzle), 'satisfied')
  assert.equal(status(rightThenLeft.grid, leftOf, rightThenLeft.puzzle), 'violated')
  assert.equal(status(rightThenLeft.grid, rightOf, rightThenLeft.puzzle), 'satisfied')

  const pending = withPlaces([['color', 0, 1]])
  restrictValue(pending.grid, 'name', 0, [0, 1])
  assert.equal(status(pending.grid, same, pending.puzzle), 'pending')
  assert.equal(status(pending.grid, nextTo, pending.puzzle), 'pending')
  assert.equal(status(pending.grid, before, pending.puzzle), 'pending')
  assert.equal(status(pending.grid, leftOf, pending.puzzle), 'pending')

  const pendingAfter = withPlaces([['color', 0, 0]])
  restrictValue(pendingAfter.grid, 'name', 0, [0, 1])
  assert.equal(status(pendingAfter.grid, after, pendingAfter.puzzle), 'pending')
  assert.equal(status(pendingAfter.grid, rightOf, pendingAfter.puzzle), 'pending')
})

test('between evaluates satisfied, pending and violated', () => {
  const between = {
    type: 'between',
    subject: 'color:Red',
    after: 'name:Ann',
    before: 'age:30 years',
  }

  const satisfied = withPlaces([
    ['color', 0, 1],
    ['name', 0, 0],
    ['age', 0, 2],
  ])
  assert.equal(status(satisfied.grid, between, satisfied.puzzle), 'satisfied')

  const violated = withPlaces([
    ['color', 0, 0],
    ['name', 0, 1],
    ['age', 0, 2],
  ])
  assert.equal(status(violated.grid, between, violated.puzzle), 'violated')

  const pending = withPlaces([
    ['color', 0, 1],
    ['age', 0, 2],
  ])
  restrictValue(pending.grid, 'name', 0, [0, 1])
  assert.equal(status(pending.grid, between, pending.puzzle), 'pending')
})

test('evaluateClue aggregates constraint statuses by priority', () => {
  const { puzzle, grid } = withPlaces([
    ['name', 0, 0],
    ['color', 0, 0],
  ])
  const makeClue = (constraints) => ({ id: 'x', text: '', entities: [], constraints })

  const atFirst = { type: 'at', subject: 'color:Red', positions: 'first' }
  const annIsRed = { type: 'same', a: 'name:Ann', b: 'color:Red' }
  const annIsBlue = { type: 'same', a: 'name:Ann', b: 'color:Blue' }

  assert.equal(evaluateClue(makeClue([atFirst, annIsRed]), puzzle, grid).status, 'satisfied')
  assert.equal(evaluateClue(makeClue([atFirst, annIsBlue]), puzzle, grid).status, 'violated')
  assert.equal(evaluateClue(makeClue([atFirst, { type: 'bogus' }]), puzzle, grid).status, 'unknown')
})

test('clues without constraints fall back to placing every named value', () => {
  const puzzle = makeTestPuzzle()
  const grid = emptyGrid(puzzle)
  const clue = {
    id: 'x',
    text: 'The Red one is here.',
    entities: [],
    constraints: [],
  }

  assert.equal(evaluateClue(clue, puzzle, grid).status, 'pending')

  placeValue(grid, 'color', 0, 0)
  assert.equal(evaluateClue(clue, puzzle, grid).status, 'satisfied')

  const noValues = {
    id: 'y',
    text: 'This clue names nothing.',
    entities: [],
    constraints: [],
  }
  assert.equal(evaluateClue(noValues, puzzle, emptyGrid(puzzle)).status, 'unknown')
})

test('findValueLinks matches case-insensitively and understands age variants', () => {
  const puzzle = makePuzzle({
    categories: [
      { id: 'age', label: 'Age', values: ['38 years', '46 years'] },
      { id: 'color', label: 'Color', values: ['Red', 'Blue'] },
    ],
  })

  const links = findValueLinks('The 38-year-old wearing Red.', puzzle)
  assert.deepEqual(
    links.map(({ categoryId, index }) => ({ categoryId, index })),
    [
      { categoryId: 'age', index: 0 },
      { categoryId: 'color', index: 0 },
    ],
  )

  assert.equal(findValueLinks('RED', puzzle)[0].categoryId, 'color')
})

test('findValueLinks prefers the earlier, longer match', () => {
  const puzzle = makePuzzle({
    categories: [
      { id: 'city', label: 'City', values: ['New York'] },
      { id: 'state', label: 'State', values: ['York'] },
    ],
  })

  const links = findValueLinks('New York', puzzle)
  assert.equal(links.length, 1)
  assert.equal(links[0].categoryId, 'city')
})

test('describeConstraint renders readable constraint descriptions', () => {
  const puzzle = makeTestPuzzle()

  assert.equal(
    describeConstraint({ type: 'at', subject: 'color:Red', positions: 'ends' }, puzzle),
    'Red (Color) is at one of the ends',
  )
  assert.equal(
    describeConstraint(
      { type: 'between', subject: 'color:Red', after: 'name:Ann', before: 'age:30 years' },
      puzzle,
    ),
    'Red (Color) is somewhere between Ann (Name) and 30 years (Age), in that order',
  )
})
