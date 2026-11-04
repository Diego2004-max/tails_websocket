/**
 * tally does not use a service worker. Browsers (or extensions) sometimes still request
 * /sw.js on localhost after another project registered one on the same port.
 * If this script is installed as a worker, it unregisters itself on activate.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
