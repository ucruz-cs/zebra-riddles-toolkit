import test from 'node:test'
import assert from 'node:assert/strict'

import { createApp } from '../server.mjs'

test('server serves files, returns 404 for directories, and blocks traversal', async (t) => {
  const server = createApp()

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )

  const base = `http://127.0.0.1:${server.address().port}`

  const home = await fetch(`${base}/`)
  assert.equal(home.status, 200)
  assert.match(await home.text(), /Zebra \/ Einstein Riddles/)

  const sample = await fetch(`${base}/samples/houses.json`)
  assert.equal(sample.status, 200)
  assert.equal((await sample.json()).title, 'Houses')

  assert.equal((await fetch(`${base}/samples/`)).status, 404)
  assert.equal((await fetch(`${base}/nope.js`)).status, 404)
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 403)
})
