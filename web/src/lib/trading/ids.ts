// Id generation for the sandbox.
//
// This is the ONE place under lib/trading/ where Math.random() is allowed, and
// purity.test.ts exempts it by name. Ids are not part of the simulation: they
// never feed a price, a fill, or anything else that has to replay identically,
// so drawing them from the seeded RNG would only couple two unrelated things.

/**
 * A uuid, falling back when the platform won't give us one.
 *
 * `crypto.randomUUID` is undefined on an insecure origin — which is exactly how
 * this app gets tested on a phone, over http to a LAN IP. The tracker already
 * calls it bare for transfer ids, but trading mints ids constantly (every order,
 * every trade, every account), so here it needs the fallback.
 */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0
  }
  // Set the version (4) and variant bits, so the result is a well-formed v4 and
  // not merely a random-looking string.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

/**
 * An order id in paper.py's shape: the account's running sequence, a dash, and
 * six hex characters. The sequence is what the user sees and sorts by; the
 * suffix is what keeps it unique across a restore.
 */
export function orderId(seq: number): string {
  return `${seq}-${uuid().replace(/-/g, '').slice(0, 6)}`
}
