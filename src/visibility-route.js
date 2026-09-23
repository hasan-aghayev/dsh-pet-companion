/**
 * Same-origin route used by the DSH sidebar visibility switch.
 * The endpoint exposes one non-sensitive boolean and rejects cross-origin writes.
 */

export const PET_VISIBILITY_PATH = '/api/pet-companion/visibility'

function respond(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  res.end(JSON.stringify(value))
}

async function readPayload(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.length
    if (length > 1024) throw Object.assign(new Error('Request body is too large.'), { status: 413 })
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Expected a JSON object with a boolean visible value.'), { status: 400 })
  }
}

export function registerVisibilityRoute(webServer, { requestRejection, getVisible, setVisible }) {
  return webServer.register({
    kind: 'exact',
    path: PET_VISIBILITY_PATH,
    handler: async (req, res) => {
      const rejection = requestRejection(req)
      if (rejection) {
        respond(res, rejection, { error: rejection === 401 ? 'Authentication required.' : 'Request rejected by DSH.' })
        return
      }
      if (req.method === 'GET') {
        respond(res, 200, { visible: Boolean(getVisible()) })
        return
      }
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' })
        return
      }
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) {
        respond(res, 415, { error: 'Expected application/json.' })
        return
      }
      let payload
      try {
        payload = await readPayload(req)
      } catch (error) {
        respond(res, error.status || 400, { error: error.status === 413 ? 'Request body is too large.' : 'Expected a JSON object with a boolean visible value.' })
        return
      }
      if (!payload || typeof payload.visible !== 'boolean') {
        respond(res, 400, { error: 'Expected a JSON object with a boolean visible value.' })
        return
      }
      try {
        await setVisible(payload.visible)
        respond(res, 200, { visible: Boolean(getVisible()) })
      } catch {
        respond(res, 500, { error: 'Could not update pet visibility.' })
      }
    },
  })
}
