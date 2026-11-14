// Creates a short random ID for this browser tab (its "site").
// Uses crypto.getRandomValues, which works on plain http:// pages such as
// http://192.168.1.5:8080 on a phone. crypto.randomUUID() does NOT: browsers
// only provide it on secure pages (https:// or localhost).
export function createSiteId(cryptoApi = globalThis.crypto) {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `u-${hex}`;
}