// Wavo service worker — the always-on doorman.
// Sits in the browser even when the Wavo tab is closed, listens for push
// events from the push service, and shows the OS-level notification pop-up.
 
self.addEventListener("install", () => {
  // Activate immediately on first install (don't wait for old SW to die)
  self.skipWaiting();
});
 
self.addEventListener("activate", (event) => {
  // Take control of any already-open Wavo tabs right away
  event.waitUntil(self.clients.claim());
});
 
// Fires when the push service delivers a message from our Edge Function
self.addEventListener("push", (event) => {
  let data = {};
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
    tag: data.tag || "wavo-message",   // tag dedupes — newer push replaces older
    renotify: true,                    // still buzz even if tag matches
    data: {
      url: data.url || "/",
      sender_id: data.sender_id || null,
    },
  };
 
  event.waitUntil(self.registration.showNotification(title, options));
});
 
// User clicked the notification — focus existing Wavo tab or open one
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
 
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // Reuse an existing Wavo tab if one's open
        for (const client of clientsArr) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.postMessage({ type: "notification-click", url: targetUrl });
            return client.focus();
          }
        }
        // Otherwise open a new one
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});