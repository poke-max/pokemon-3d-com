const CACHE_VERSION = 'pokemon-assets-v1'
const RUNTIME_CACHE = CACHE_VERSION
const CACHEABLE_PATHS = ['/pokemon/', '/draco/']

const shouldCacheRequest = (request) => {
  const url = new URL(request.url)
  if (request.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  return CACHEABLE_PATHS.some((path) => url.pathname.includes(path))
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('pokemon-assets') && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (!shouldCacheRequest(event.request)) return

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cachedResponse = await cache.match(event.request)
      if (cachedResponse) return cachedResponse

      try {
        const response = await fetch(event.request)
        if (response && response.ok) {
          cache.put(event.request, response.clone())
        }
        return response
      } catch (error) {
        if (cachedResponse) return cachedResponse
        throw error
      }
    })
  )
})
