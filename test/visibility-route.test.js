import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { PET_VISIBILITY_PATH, registerVisibilityRoute } from '../src/visibility-route.js'

function createRoute(initialVisible = true) {
  let visible = initialVisible
  let route
  let writes = 0
  const dispose = registerVisibilityRoute({
    register(value) {
      route = value
      return () => { route = undefined }
    },
  }, {
    requestRejection: (req) => {
      const origin = req.headers?.origin
      const host = req.headers?.host
      if (!origin || !host) return undefined
      try { return new URL(origin).host.toLowerCase() === host.toLowerCase() ? undefined : 403 } catch { return 403 }
    },
    getVisible: () => visible,
    setVisible: async (next) => { visible = next; writes += 1 },
  })
  return { get route() { return route }, get writes() { return writes }, dispose }
}

async function request(route, method, headers = {}, body = '') {
  const req = Readable.from(body ? [body] : [])
  req.method = method
  req.headers = headers
  const res = {
    writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders },
    end(value) { this.body = value },
  }
  await route.handler(req, res)
  return { ...res, json: JSON.parse(res.body) }
}

test('visibility route exposes current state without caching', async () => {
  const harness = createRoute(false)
  assert.equal(harness.route.path, PET_VISIBILITY_PATH)
  const response = await request(harness.route, 'GET')
  assert.equal(response.status, 200)
  assert.deepEqual(response.json, { visible: false })
  assert.equal(response.headers['Cache-Control'], 'no-store')
  harness.dispose()
  assert.equal(harness.route, undefined)
})

test('same-origin switch writes the new state', async () => {
  const harness = createRoute(true)
  const response = await request(harness.route, 'POST', {
    origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', 'content-type': 'application/json',
  }, JSON.stringify({ visible: false }))
  assert.equal(response.status, 200)
  assert.deepEqual(response.json, { visible: false })
  assert.equal(harness.writes, 1)
})

test('visibility route uses the DSH authentication fence', async () => {
  let route
  registerVisibilityRoute({ register(value) { route = value; return () => {} } }, {
    requestRejection: () => 401, getVisible: () => true, setVisible: async () => {},
  })
  const response = await request(route, 'GET')
  assert.equal(response.status, 401)
})

test('visibility route rejects cross-origin and invalid updates', async () => {
  const harness = createRoute(true)
  const crossOrigin = await request(harness.route, 'POST', {
    origin: 'http://attacker.example', host: '127.0.0.1:3080', 'content-type': 'application/json',
  }, JSON.stringify({ visible: false }))
  assert.equal(crossOrigin.status, 403)
  assert.equal(harness.writes, 0)
  const invalid = await request(harness.route, 'POST', {
    origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', 'content-type': 'application/json',
  }, JSON.stringify({ visible: 'false' }))
  assert.equal(invalid.status, 400)
  assert.equal(harness.writes, 0)
  const method = await request(harness.route, 'DELETE')
  assert.equal(method.status, 405)
})
