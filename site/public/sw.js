self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Kakwa Dispatch', body: '' }
  event.waitUntil(self.registration.showNotification(data.title || 'Kakwa Dispatch', { body: data.body || '' }))
})
