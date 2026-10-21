import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const publicDir = join(root, 'public')
const samplesDir = join(root, 'samples')
const port = Number(process.env.PORT || 3000)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'

    let base = publicDir
    if (pathname.startsWith('/samples/')) {
      base = samplesDir
      pathname = pathname.slice('/samples'.length)
    }

    const target = normalize(join(base, pathname))
    const baseWithSep = base.endsWith(sep) ? base : base + sep
    if (!target.startsWith(baseWithSep)) {
      send(res, 403, 'Forbidden')
      return
    }

    const data = await readFile(target)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR')) {
      send(res, 404, 'Not found')
      return
    }
    console.error(err)
    send(res, 500, 'Server error')
  }
}

export function createApp() {
  return createServer(handleRequest)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const server = createApp()
  server.listen(port, () => {
    console.log(`Zebra / Einstein Riddles is running at http://localhost:${port}`)
  })
}
