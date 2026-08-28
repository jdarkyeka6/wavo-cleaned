// Wavo service worker: app shell + push notifications.
const CACHE_NAME = "wavo-shell-v3";
const SHELL = ["/", "/index.html", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req);

    try {
      const response = await fetch(req);

      if (response && response.ok) {
        const copy = response.clone();
        event.waitUntil(
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(req, copy))
            .catch(() => {})
        );
      }

      return response;
    } catch {
      if (cached) return cached;

      // BrowserRouter routes such as /admin need the SPA shell when offline
      // or when the host temporarily fails a direct navigation request.
      if (req.mode === "navigate") {
        const shell = await caches.match("/index.html");
        if (shell) return shell;
      }

      return Response.error();
    }
  })());
});

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Wavo", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Wavo";
  const options = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || "wavo-message",
    renotify: true,
    data: {
      url: data.url || "/",
      sender_id: data.sender_id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        for (const client of clientsArr) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.postMessage({ type: "notification-click", url: targetUrl });
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
