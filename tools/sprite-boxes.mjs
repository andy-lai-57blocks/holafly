// S4 harvest table. `box` is in the 720px-wide store-screenshot space.
// `seed` is a point inside the sticker, in crop space.
// `exclude` are matte hints in crop space: rectangles known to be device
// mockup rather than sticker, painted out before the cutout runs. They are the
// hand-authored equivalent of a mask layer, measured by eye against the crop.
//
// Only assets that are *brand identity* or that separate cleanly from the
// device mockup are harvested as raster. The store creative composites several
// stickers directly onto the phone's white screen, where a white sticker halo
// and a white UI surface are the same colour and no matte can divide them; the
// rocket and money-stack props are therefore redrawn procedurally in the same
// white-outline sticker idiom instead of being shipped as a dirty cutout.
export const SPRITES = [
  {
    name: 'wordmark',
    src: 'img_46.png',
    box: [225, 105, 280, 80],
    mode: 'key-coral',
    targetWidth: 240,
    quality: 88,
    provenance: 'Hero screenshot header — the official Holafly wordmark with the wave crossbar.',
    role: 'Brand identity. Endcard lockup and gameplay HUD.',
  },
  {
    name: 'logomark',
    src: 'icon.png',
    mode: 'round',
    targetWidth: 160,
    radius: 0.22,
    quality: 90,
    provenance: 'Play Store app icon, 512x512 — crimson gradient tile, white wave-crossbar H.',
    role: 'Brand identity. Endcard app tile, and the eSIM the runner is carrying.',
  },
  {
    name: 'orb-unlimited',
    src: 'img_20.png',
    box: [50, 480, 170, 114],
    seed: [60, 62],
    exclude: [],
    mode: 'cutout',
    targetWidth: 120,
    quality: 88,
    provenance: '"True Unlimited Data" screenshot — the infinity sticker badge.',
    role: 'Collectible. Refills the signal meter, mirroring unlimited data with no caps.',
  },
  {
    name: 'coin-savings',
    src: 'img_4.png',
    box: [20, 660, 155, 215],
    seed: [70, 150],
    exclude: [[130, 0, 25, 110], [76, 182, 79, 33], [146, 0, 9, 215]],
    mode: 'cutout',
    targetWidth: 104,
    quality: 88,
    provenance: '"No roaming fees" screenshot — the piggy-bank sticker.',
    role: 'Collectible. Savings pickup, mirroring the no-roaming-fees value proposition.',
  },
];
