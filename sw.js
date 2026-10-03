/**
 * VitalGuard AI - Service Worker
 * Offline-First Caching and Synchronization Strategy
 *
 * Cache Name: vitalguard-v1
 *
 * Architecture & Strategy:
 * 1. Install Phase (Pre-caching):
 *    - Opens designated cache 'vitalguard-v1'
 *    - Pre-caches core application shell assets (HTML, CSS, core JS modules)
 *    - Calls self.skipWaiting() to immediately activate without waiting for existing tabs to close.
 *
 * 2. Activate Phase (Cache Invalidation & Client Claiming):
 *    - Iterates through all existing caches under this origin
 *    - Purges any obsolete/previous version caches (anything !== 'vitalguard-v1')
 *    - Calls self.clients.claim() to instantly take control of all active clients/pages.
 *
 * 3. Fetch Phase (Cache-First with Dynamic Network Fallback & Caching):
 *    - Handles only GET requests (ignores non-GET requests)
 *    - Cache-First: Checks local cache for a matching request
 *    - If found in cache, immediately returns cached response for offline speed & autonomy
 *    - If cache miss: Fetches from network, caches valid responses dynamically for future visits
 *    - Offline Failure: If network fetch fails (offline/disconnected):
 *        * If the request is a navigation request (page load), falls back to cached '/index.html'
 *        * Otherwise checks if any fallback match exists in cache
 */

const CACHE_NAME = 'vitalguard-v1';

// Static assets required for complete offline operation of VitalGuard AI
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/db.js',
  '/js/risk-engine.js',
  '/js/sensor.js',
  '/js/alerts.js',
  '/js/charts.js',
  '/js/demo.js',
  '/js/app.js'
];

/**
 * Service Worker Installation Event
 * Caches core assets and activates worker immediately.
 */
self.addEventListener('install', (event) => {
  console.log('[VitalGuard SW] Install event triggered. Caching core assets into:', CACHE_NAME);

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use resilient pre-caching: try batch addAll first, fallback to individual adds
      // if any individual asset is still being drafted during incremental development.
      try {
        await cache.addAll(PRECACHE_ASSETS);
        console.log('[VitalGuard SW] Pre-caching completed successfully.');
      } catch (err) {
        console.warn('[VitalGuard SW] Batch precache failed, attempting individual asset cache:', err);
        for (const assetUrl of PRECACHE_ASSETS) {
          try {
            await cache.add(assetUrl);
          } catch (individualErr) {
            console.warn(`[VitalGuard SW] Could not precache individual asset: ${assetUrl}`, individualErr);
          }
        }
      }
    }).then(() => {
      // Force activation without waiting for existing clients to close
      return self.skipWaiting();
    })
  );
});

/**
 * Service Worker Activation Event
 * Purges old caches to ensure fresh application updates and claims open clients.
 */
self.addEventListener('activate', (event) => {
  console.log('[VitalGuard SW] Activate event triggered. Cleaning stale caches...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[VitalGuard SW] Removing obsolete cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Immediately take control of all uncontrolled clients/windows
      console.log('[VitalGuard SW] Claiming clients for instant control.');
      return self.clients.claim();
    })
  );
});

/**
 * Service Worker Fetch Event
 * Implements Cache-First strategy with dynamic network fallback and offline navigation fallback.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle HTTP/HTTPS GET requests; ignore WebSocket, chrome-extension, and non-GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // 1. Cache-First: Return from cache if found
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Cache Miss: Attempt network fetch
      return fetch(request)
        .then((networkResponse) => {
          // Verify valid response before adding to cache
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            // Clone response since stream can only be consumed once
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async (fetchError) => {
          console.warn(`[VitalGuard SW] Network fetch failed for: ${request.url}. Serving offline fallback if available.`);

          // 3. Network Failure Fallback
          // For navigation requests (page navigation / reload), return /index.html
          if (request.mode === 'navigate') {
            const indexFallback = await caches.match('/index.html') || await caches.match('/');
            if (indexFallback) {
              return indexFallback;
            }
          }

          // Return matched cache if available through alternative URL format
          const fallbackMatch = await caches.match(request);
          if (fallbackMatch) {
            return fallbackMatch;
          }

          // Propagate error if no cache exists
          throw fetchError;
        });
    })
  );
});
