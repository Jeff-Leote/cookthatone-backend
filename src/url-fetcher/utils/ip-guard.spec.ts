import { isForbiddenIp } from './ip-guard';

describe('ip-guard', () => {
  // [plage, adresse dans la plage, adresse juste à l'extérieur, extérieur couvert par une plage voisine]
  const ipv4Ranges: Array<[string, string, string, boolean?]> = [
    ['0.0.0.0/8', '0.0.0.0', '1.0.0.0'],
    ['0.0.0.0/8', '0.255.255.255', '1.0.0.1'],
    ['10.0.0.0/8', '10.1.2.3', '11.0.0.0'],
    ['100.64.0.0/10', '100.64.0.1', '100.128.0.0'],
    ['100.64.0.0/10', '100.127.255.255', '100.63.255.255'],
    ['127.0.0.0/8', '127.0.0.1', '128.0.0.1'],
    ['169.254.0.0/16', '169.254.169.254', '169.255.0.0'],
    ['172.16.0.0/12', '172.16.0.1', '172.32.0.0'],
    ['172.16.0.0/12', '172.31.255.255', '172.15.255.255'],
    ['192.0.0.0/24', '192.0.0.8', '192.0.1.1'],
    ['192.0.2.0/24', '192.0.2.10', '192.0.3.1'],
    ['192.168.0.0/16', '192.168.1.1', '192.169.0.1'],
    ['198.18.0.0/15', '198.19.255.255', '198.20.0.0'],
    ['198.18.0.0/15', '198.18.0.1', '198.17.255.255'],
    ['198.51.100.0/24', '198.51.100.7', '198.51.101.1'],
    ['203.0.113.0/24', '203.0.113.99', '203.0.114.1'],
    ['224.0.0.0/4', '224.0.0.1', '223.255.255.255'],
    ['240.0.0.0/4', '240.0.0.1', '239.255.255.255', true],
    ['255.255.255.255/32', '255.255.255.255', '254.255.255.255', true],
  ];

  it.each(ipv4Ranges)(
    'IPv4 %s : refuse %s, extérieur %s',
    (_range, inside, outside, outsideCovered = false) => {
      expect(isForbiddenIp(inside)).toBe(true);
      expect(isForbiddenIp(outside)).toBe(outsideCovered);
    },
  );

  it.each([
    ['::'],
    ['::1'],
    ['fc00::1'],
    ['fdff:ffff::1'],
    ['fe80::1'],
    ['febf::1'],
    ['ff02::1'],
    ['2001:db8::1'],
    ['2001:0db8:0:0:0:0:0:1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'],
    ['::ffff:10.0.0.1'],
    ['::ffff:169.254.169.254'],
    ['::FFFF:A9FE:A9FE'],
    ['64:ff9b::7f00:1'],
    ['64:ff9b::10.0.0.1'],
    ['2002:7f00:1::'],
    ['2002:c0a8:101::1'],
    ['::127.0.0.1'],
    ['0:0:0:0:0:0:0:1'],
  ])('IPv6 interdite : %s', (address) => {
    expect(isForbiddenIp(address)).toBe(true);
  });

  it.each([
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
    ['fe00::1'],
    ['::ffff:93.184.216.34'],
    ['::ffff:5db8:d822'],
    ['64:ff9b::5db8:d822'],
    ['2002:5db8:d822::1'],
    ['2a00:1450:4007:80f::200e'],
  ])('IPv6 publique acceptée : %s', (address) => {
    expect(isForbiddenIp(address)).toBe(false);
  });

  it('accepte les adresses IPv4 publiques', () => {
    expect(isForbiddenIp('93.184.216.34')).toBe(false);
    expect(isForbiddenIp('8.8.8.8')).toBe(false);
    expect(isForbiddenIp('1.1.1.1')).toBe(false);
  });

  it('gère les crochets IPv6', () => {
    expect(isForbiddenIp('[::1]')).toBe(true);
    expect(isForbiddenIp('[::ffff:7f00:1]')).toBe(true);
    expect(isForbiddenIp('[2606:4700:4700::1111]')).toBe(false);
  });

  it.each([
    ['http://2130706433/'],
    ['http://0x7f.1/'],
    ['http://0177.0.0.1/'],
    ['http://017700000001/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[0:0:0:0:0:ffff:7f00:1]/'],
  ])('refuse la forme alternative normalisée par new URL : %s', (url) => {
    expect(isForbiddenIp(new URL(url).hostname)).toBe(true);
  });

  it.each([
    [''],
    ['abc'],
    ['256.1.1.1'],
    ['1.2.3'],
    ['1.2.3.4.5'],
    ['010.0.0.1'],
    ['1.2.3.-4'],
    ['fe80::1%eth0'],
    [':::'],
    ['1::2::3'],
    ['12345::1'],
    ['1:2:3:4:5:6:7:8:9'],
    ['1:2:3:4:5:6:7'],
    ['::g'],
    ['::1.2.3'],
  ])('refuse dans le doute (forme illisible) : "%s"', (address) => {
    expect(isForbiddenIp(address)).toBe(true);
  });
});

describe('ip-guard : 192.88.99.0/24 (ancien relais 6to4)', () => {
  it('refuse les bornes de la plage et accepte juste avant et juste après', () => {
    expect(isForbiddenIp('192.88.99.0')).toBe(true);
    expect(isForbiddenIp('192.88.99.255')).toBe(true);
    expect(isForbiddenIp('192.88.98.255')).toBe(false);
    expect(isForbiddenIp('192.88.100.0')).toBe(false);
  });

  it.each([
    ['::ffff:192.88.99.0', true],
    ['::ffff:192.88.99.255', true],
    ['::ffff:c058:6300', true],
    ['::ffff:c058:63ff', true],
    ['::ffff:192.88.98.255', false],
    ['::ffff:c058:6400', false],
    ['2002:c058:6300::', true],
    ['2002:c058:63ff::1', true],
    ['2002:c058:62ff::1', false],
    ['2002:c058:6400::1', false],
  ])('forme IPv6 embarquant la plage : %s', (address, forbidden) => {
    expect(isForbiddenIp(address)).toBe(forbidden);
  });
});

describe('ip-guard : plages IPv6 réservées', () => {
  // [plage, première, dernière, juste avant (accepté), juste après (accepté)]
  const ranges: Array<[string, string, string, string, string]> = [
    [
      '100::/64',
      '100::',
      '100::ffff:ffff:ffff:ffff',
      'ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '100:0:0:1::',
    ],
    [
      '2001::/23',
      '2001::',
      '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
      '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '2001:200::',
    ],
    [
      '2001:2::/48 (dans 2001::/23)',
      '2001:2::',
      '2001:2:0:ffff:ffff:ffff:ffff:ffff',
      '2000:ffff::1',
      '2001:200::1',
    ],
    [
      '2001:10::/28 (dans 2001::/23)',
      '2001:10::',
      '2001:1f:ffff:ffff:ffff:ffff:ffff:ffff',
      '2000:ffff::1',
      '2001:200::1',
    ],
    [
      '2001:20::/28 (dans 2001::/23)',
      '2001:20::',
      '2001:2f:ffff:ffff:ffff:ffff:ffff:ffff',
      '2000:ffff::1',
      '2001:200::1',
    ],
    [
      '3fff::/20',
      '3fff::',
      '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
      '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '3fff:1000::',
    ],
    [
      '5f00::/16',
      '5f00::',
      '5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '5f01::',
    ],
  ];

  it.each(ranges)('%s', (_range, first, last, before, after) => {
    expect(isForbiddenIp(first)).toBe(true);
    expect(isForbiddenIp(last)).toBe(true);
    expect(isForbiddenIp(before)).toBe(false);
    expect(isForbiddenIp(after)).toBe(false);
  });

  it('accepte les adresses publiques voisines', () => {
    expect(isForbiddenIp('2606:4700:4700::1111')).toBe(false);
    expect(isForbiddenIp('2001:4860:4860::8888')).toBe(false);
    expect(isForbiddenIp('2a00:1450:4007:80f::200e')).toBe(false);
  });
});

describe('ip-guard : autres formes IPv6 embarquantes ou réservées', () => {
  it.each([
    ['::ffff:0:127.0.0.1'],
    ['::ffff:0:7f00:1'],
    ['::ffff:0:10.0.0.1'],
    ['::ffff:0:169.254.169.254'],
  ])('IPv4-traduite interne refusée : %s', (address) => {
    expect(isForbiddenIp(address)).toBe(true);
  });

  it("accepte une IPv4-traduite dont l'IPv4 est publique", () => {
    expect(isForbiddenIp('::ffff:0:93.184.216.34')).toBe(false);
  });

  it('refuse le NAT64 à usage local 64:ff9b:1::/48 sur toute son étendue', () => {
    expect(isForbiddenIp('64:ff9b:1::')).toBe(true);
    expect(isForbiddenIp('64:ff9b:1:ffff:ffff:ffff:ffff:ffff')).toBe(true);
    expect(isForbiddenIp('64:ff9b:1::5db8:d822')).toBe(true);
  });

  it('refuse Teredo 2001:0::/32 sur toute son étendue', () => {
    expect(isForbiddenIp('2001:0::')).toBe(true);
    expect(isForbiddenIp('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true);
    expect(isForbiddenIp('2001:0:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
  });

  it('refuse fec0::/10 (site-local) et accepte juste avant fe80::/10', () => {
    expect(isForbiddenIp('fec0::')).toBe(true);
    expect(isForbiddenIp('fec0::1')).toBe(true);
    expect(isForbiddenIp('feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
    expect(isForbiddenIp('fe7f:ffff::1')).toBe(false);
  });
});

describe('ip-guard : zéros de tête dans un octet IPv4', () => {
  it.each([
    ['0127.0.0.1'],
    ['127.000.000.001'],
    ['127.0.0.01'],
    ['00.0.0.0'],
    // publique une fois les zéros ignorés : le refus vient bien de la forme
    ['093.184.216.34'],
    ['93.184.216.034'],
  ])('refuse %s', (address) => {
    expect(isForbiddenIp(address)).toBe(true);
  });

  it('accepte la même adresse sans zéro de tête', () => {
    expect(isForbiddenIp('93.184.216.34')).toBe(false);
  });
});

describe('ip-guard : NAT64 64:ff9b::/32', () => {
  it("64:ff9b::/96 : valide l'IPv4 embarquée avec les règles IPv4", () => {
    // IPv4 embarquée interne : refusée
    expect(isForbiddenIp('64:ff9b::')).toBe(true); // 0.0.0.0
    expect(isForbiddenIp('64:ff9b::7f00:1')).toBe(true);
    expect(isForbiddenIp('64:ff9b::10.0.0.1')).toBe(true);
    expect(isForbiddenIp('64:ff9b::169.254.169.254')).toBe(true);
    // IPv4 embarquée publique : acceptée (comportement inchangé)
    expect(isForbiddenIp('64:ff9b::8.8.8.8')).toBe(false);
    expect(isForbiddenIp('64:ff9b::808:808')).toBe(false);
    expect(isForbiddenIp('64:ff9b::5db8:d822')).toBe(false);
  });

  it('refuse sans condition le reste de 64:ff9b::/32, bornes comprises', () => {
    expect(isForbiddenIp('64:ff9b::1:0:0')).toBe(true);
    expect(isForbiddenIp('64:ff9b:0:1::')).toBe(true);
    expect(isForbiddenIp('64:ff9b:1::')).toBe(true);
    expect(isForbiddenIp('64:ff9b:2::')).toBe(true);
    expect(isForbiddenIp('64:ff9b:2::8.8.8.8')).toBe(true);
    expect(isForbiddenIp('64:ff9b:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
  });

  it('accepte les préfixes voisins hors de 64:ff9b::/32', () => {
    expect(isForbiddenIp('64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(false);
    expect(isForbiddenIp('64:ff9c::')).toBe(false);
  });
});
