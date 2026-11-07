// Protecție SSRF: blochează localhost, rețele private, loopback, link-local etc.
import dns from 'node:dns';
import net from 'node:net';

export class BlockedAddressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedAddressError';
    this.code = 'ERR_BLOCKED_ADDRESS';
    this.status = 400;
  }
}

const blockList = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], // "această" rețea
  ['10.0.0.0', 8], // privat
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (inclusiv metadata cloud 169.254.169.254)
  ['172.16.0.0', 12], // privat
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // documentație
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // privat
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentație
  ['203.0.113.0', 24], // documentație
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // rezervat + broadcast
]) {
  blockList.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 96], // nespecificat, loopback (::1), IPv4-compatibil
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (depreciat)
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentație
]) {
  blockList.addSubnet(addr, prefix, 'ipv6');
}

/** true dacă adresa IP este privată / rezervată (sau invalidă). */
export function isBlockedIp(address) {
  let addr = String(address ?? '').trim().replace(/^\[|\]$/g, '');
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  const type = net.isIP(addr);
  if (!type) return true;
  if (type === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
    if (mapped) return isBlockedIp(mapped[1]);
  }
  try {
    return blockList.check(addr, type === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return true;
  }
}

function cleanHost(hostname) {
  return String(hostname ?? '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
}

/** Verificare sincronă pe hostname (fără DNS): localhost și IP-uri literale. */
export function assertHostnameAllowed(hostname) {
  const host = cleanHost(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new BlockedAddressError(`Adresă blocată (rețea locală): ${hostname}`);
  }
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new BlockedAddressError(`Adresă blocată (IP privat sau rezervat): ${hostname}`);
  }
}

/**
 * Verifică un URL complet: protocol, hostname și toate adresele DNS rezolvate.
 * @param {string|URL} url
 */
export async function assertPublicUrl(url) {
  const u = typeof url === 'string' ? new URL(url) : url;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BlockedAddressError('Sunt permise doar URL-uri http și https.');
  }
  assertHostnameAllowed(u.hostname);
  const host = cleanHost(u.hostname);
  if (net.isIP(host)) return;
  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    const err = new Error(`Domeniul ${host} nu poate fi rezolvat (DNS).`);
    err.code = 'ERR_DNS';
    err.status = 400;
    throw err;
  }
  if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
    throw new BlockedAddressError(`Adresă blocată: ${host} indică o rețea privată.`);
  }
}

/**
 * Funcție `lookup` pentru http.request: validează IP-ul la momentul conectării,
 * deci acoperă și redirecționările și DNS rebinding.
 */
export function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (typeof options === 'number') {
    options = { family: options };
  }
  options = options ?? {};
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses?.length) {
      const e = new Error(`Domeniul ${hostname} nu are adrese.`);
      e.code = 'ENOTFOUND';
      return callback(e);
    }
    if (addresses.some((a) => isBlockedIp(a.address))) {
      return callback(new BlockedAddressError(`Adresă blocată: ${hostname} indică o rețea privată.`));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}
