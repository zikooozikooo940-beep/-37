self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'دوري قاضي عياض';
  const options = {
    body: data.body || data.message || 'لديك إشعار جديد من إدارة الدوري.',
    data: { url: data.url || '/#home' },
    tag: data.tag || 'qadiyadh-league'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/#home', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) if (client.url.startsWith(self.location.origin) && 'focus' in client) { client.navigate(destination); return client.focus(); }
    return self.clients.openWindow(destination);
  }));
});
