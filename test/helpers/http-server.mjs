import http from 'node:http'

const readRequestBody = async request => {
  let contents = ''
  request.setEncoding('utf8')
  for await (const chunk of request) contents += chunk
  return contents.length === 0 ? null : JSON.parse(contents)
}

export async function startOpenAiServer(testContext, handler) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    try {
      const captured = {
        body: await readRequestBody(request),
        headers: request.headers,
        method: request.method,
        url: request.url,
      }
      requests.push(captured)
      const result = await handler(captured)
      response.writeHead(result.status, {'content-type': 'application/json'})
      response.end(JSON.stringify(result.body))
    } catch (error) {
      response.writeHead(500, {'content-type': 'application/json'})
      response.end(JSON.stringify({error: {message: error instanceof Error ? error.message : String(error)}}))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  testContext.after(async () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  }))

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the local test server to expose a TCP address.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
  }
}
