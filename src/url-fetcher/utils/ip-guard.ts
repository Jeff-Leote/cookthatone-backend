/**
 * Politique d'adresses du récupérateur d'URL (fonctions pures).
 * Dans le doute (forme illisible, ambiguë), l'adresse est refusée.
 */

const FORBIDDEN_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;

function parseIpv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function cidrMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

const FORBIDDEN_IPV4_RANGES: ReadonlyArray<{ base: number; mask: number }> =
  FORBIDDEN_IPV4_CIDRS.map((cidr) => {
    const [address, prefix] = cidr.split('/');
    const mask = cidrMask(Number(prefix));
    return { base: ((parseIpv4(address) as number) & mask) >>> 0, mask };
  });

function isForbiddenIpv4Value(value: number): boolean {
  return FORBIDDEN_IPV4_RANGES.some(
    ({ base, mask }) => (value & mask) >>> 0 === base,
  );
}

/** Retourne les 8 groupes de 16 bits, ou `null` si la forme n'est pas lisible. */
function parseIpv6(input: string): number[] | null {
  let text = input;
  if (text.includes('%')) return null;

  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = (v4 >>> 16).toString(16);
    const low = (v4 & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : halves[0].split(':');
  const right =
    halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const groups = [...left, ...right];
  if (!groups.every((group) => IPV6_GROUP.test(group))) return null;

  if (halves.length === 1) {
    if (groups.length !== 8) return null;
    return groups.map((group) => parseInt(group, 16));
  }
  if (groups.length > 7) return null;
  const zeros = new Array<number>(8 - groups.length).fill(0);
  return [
    ...left.map((group) => parseInt(group, 16)),
    ...zeros,
    ...right.map((group) => parseInt(group, 16)),
  ];
}

function embeddedIpv4(high: number, low: number): number {
  return high * 0x10000 + low;
}

function isForbiddenIpv6Groups(g: number[]): boolean {
  const zeroUpTo = (end: number) => g.slice(0, end).every((x) => x === 0);

  // ::/96 : « :: », « ::1 » et les adresses IPv4-compatibles (dépréciées).
  if (zeroUpTo(6)) return true;
  // ::ffff:0:0/96 (IPv4-mappées) et ::ffff:0:0:0/96 (IPv4-traduites).
  if (zeroUpTo(5) && g[5] === 0xffff) {
    return isForbiddenIpv4Value(embeddedIpv4(g[6], g[7]));
  }
  if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) {
    return isForbiddenIpv4Value(embeddedIpv4(g[6], g[7]));
  }
  // 64:ff9b::/96 (NAT64) : IPv4 embarquée validée ; le reste de 64:ff9b::/32
  // (dont 64:ff9b:1::/48, usage local) est refusé sans condition.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((x) => x === 0)) {
      return isForbiddenIpv4Value(embeddedIpv4(g[6], g[7]));
    }
    return true;
  }
  // 2002::/16 (6to4) : IPv4 dans les groupes 1 et 2.
  if (g[0] === 0x2002) {
    return isForbiddenIpv4Value(embeddedIpv4(g[1], g[2]));
  }
  // 2001::/23 : réservé par l'IETF (Teredo, 2001:2::/48, ORCHID 2001:10::/28 et
  // 2001:20::/28, etc.), refusé en bloc ; 2001:db8::/32 (documentation).
  if (g[0] === 0x2001 && (g[1] < 0x0200 || g[1] === 0x0db8)) return true;
  // 100::/64 (rejet), 3fff::/20 (documentation), 5f00::/16 (SRv6).
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;
  if (g[0] === 0x5f00) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 (déprécié)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

/** Retire les crochets d'un hôte IPv6 (`[::1]` devient `::1`). */
export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Vrai si l'adresse (IPv4 ou IPv6, avec ou sans crochets) est interdite
 * ou illisible.
 */
export function isForbiddenIp(address: string): boolean {
  const text = stripBrackets(address.trim());
  if (text.includes(':')) {
    const groups = parseIpv6(text);
    return groups === null || isForbiddenIpv6Groups(groups);
  }
  const value = parseIpv4(text);
  return value === null || isForbiddenIpv4Value(value);
}
