/**
 * S3 CONFIG_SCAFFOLD — window.PlayableConfig
 *
 * This file is the only place in the creative where copy, colour, imagery,
 * links or tuning live. It is inlined ahead of the engine so the engine has
 * nowhere to put a literal (RULE-CFG-001, RULE-CFG-002). Everything here is
 * hot-swappable without recompiling: drop in a new dictionary, a new palette or
 * a new logo data URI and the creative re-renders.
 *
 * `__ASSET_<name>__` tokens are replaced with base64 data URIs by
 * tools/build.mjs at bundle time.
 */
window.PlayableConfig = {
  version: '1.0.0',
  campaign: 'holafly-stay-connected-runner',

  appDetails: {
    appName: 'Holafly eSIM',
    appId: 'com.holafly.holafly',
    appStoreId: '1629600786',
    appLogo: '__ASSET_logomark__',
    appWordmark: '__ASSET_wordmark__',
    // Only ever reached when the container does not route the click itself.
    // Liftoff does, so on Liftoff these are dead weight; a plain MRAID
    // container and the browser preview both need them, and the store has to
    // match the device or the tap lands on a page the user cannot install from.
    clickUrl: 'https://play.google.com/store/apps/details?id=com.holafly.holafly',
    clickUrlByPlatform: {
      ios: 'https://apps.apple.com/app/id1629600786',
      android: 'https://play.google.com/store/apps/details?id=com.holafly.holafly',
    },
  },

  // Harvested brand rasters. Procedural art is generated from `style` tokens.
  assets: {
    logomark: '__ASSET_logomark__',
    wordmark: '__ASSET_wordmark__',
    orbUnlimited: '__ASSET_orb-unlimited__',
    coinSavings: '__ASSET_coin-savings__',
  },

  // Every value traceable to brand/brand-tokens.json.
  style: {
    primaryColor: '#D7192D',
    ctaColor: '#D41A53',
    ctaTextColor: '#FFFFFF',
    coralTop: '#F08689',
    coralBottom: '#E65B76',
    maroon: '#951C39',
    accentGreen: '#48EC86',
    accentYellow: '#FFF620',
    cloudPink: '#F799A1',
    gold: '#F5C84C',
    ink: '#292B2E',
    white: '#FFFFFF',
    illustrationTeal: '#8FD3E8',
    illustrationHair: '#2B2B33',
    illustrationSkin: '#F4C9A8',
    denim: '#3E5E7E',
    fontFamily: "'Modern Era', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    // Modern Era is a Latin typeface. CJK locales intentionally fall through to
    // the platform sans; the brand has no CJK cut to embed.
    legalFontSizePx: 11,
    // Liftoff reserves a square in each top corner for the close button and
    // for regulatory watermarks, and will draw over whatever is underneath.
    // Nothing the player needs to see or tap may sit inside it.
    cornerReservePx: 50,
  },

  audio: {
    // On by default, with no in-creative toggle. It still cannot make a sound
    // before the player's first tap: the engine holds the audio context shut
    // until then, because containers block autoplay and networks reject
    // creatives that try it. Flip this to true to ship the run silent.
    defaultMuted: false,
    enabled: true,
  },

  gameplay: {
    idleTimeoutMs: 1500,
    maxGameplayDurationMs: 30000,
    ctaDebounceMs: 1000,
    difficultyLevel: 'easy',

    // Signal meter models the product promise: it drains as you travel, an
    // unlimited-data pickup refills it, a roaming charge costs you, and the
    // Always On backup rescues you once before the run can end.
    meter: {
      startPercent: 78,
      drainPerSecond: 3.6,
      orbRefill: 34,
      rescueRefill: 46,
      rescueCount: 1,
      gateRefill: 6,
    },

    // Every drain on the signal meter is a real problem a travel eSIM solves,
    // which is what RULE-CVR-002 means by mechanics that mirror the product.
    // One shared spawner draws from this table by weight, so adding kinds adds
    // variety without multiplying the pressure on the player.
    //
    //   instant — one-off hit the moment it touches you
    //   zone    — drains faster for as long as you are inside it
    //   debuff  — drains faster for a fixed time after it touches you
    //
    // A zone also wades: `speedMultiplier` is the drag applied while you are
    // standing in it, which is what makes a coverage hole feel like an
    // obstacle rather than an invisible tax on the meter. Because the drag
    // lengthens the time inside, `drainMultiplier` is tuned below what an
    // undragged zone would need for the same total cost.
    hazards: [
      { kind: 'roaming', weight: 30, effect: 'instant', penalty: 24 },
      { kind: 'wifi', weight: 24, effect: 'instant', penalty: 15 },
      {
        kind: 'deadzone',
        weight: 26,
        effect: 'zone',
        drainMultiplier: 4,
        speedMultiplier: 0.72,
        // Cadence of the interference: static puffing off the runner and the
        // audio crackle both run off this, so they stay in step.
        staticIntervalMs: 90,
      },
      { kind: 'throttle', weight: 20, effect: 'debuff', drainMultiplier: 2.5, durationMs: 3000 },
    ],

    runner: {
      jumpVelocity: 1180,
      gravity: 3050,
      airJumps: 1,
      baseSpeed: 300,
      speedRampPerSecond: 7.5,
      maxSpeed: 470,
      boostMultiplier: 1.5,
      boostDurationMs: 2600,
    },

    spawn: {
      // The first destination gate must land inside the 3–5s hook window so the
      // value proposition is demonstrated, not asserted (RULE-CVR-001).
      firstGateAfterMs: 1500,
      // Tightened from 5200 so all six borders are crossed with a couple of
      // seconds left for the finish flag. Gates are crossed one to two seconds
      // after they spawn, so at 5200 the last one landed on the 30s cap and
      // there was no room to reach a goal.
      gateIntervalMs: 4600,
      // How long the outgoing city takes to dissolve into the incoming one.
      skylineFadeMs: 1400,
      hazardIntervalMs: 2600,
      orbIntervalMs: 1950,
      boostIntervalMs: 9000,
      coinIntervalMs: 7000,
      minGapFromGateMs: 700,
      // Crossing the last destination plants a finish flag this many seconds
      // ahead of the runner, so the run ends on reaching a goal rather than on
      // a timer. Placed by time rather than distance because the runner's
      // speed at that point depends on the ramp and any active boost. Must
      // leave room inside maxGameplayDurationMs for the flag to be reached.
      finishLeadSeconds: 1.9,
    },

    // Mirrors the app's own "Short trips" destination list. China leads the
    // run so the opening seconds pay off the Shanghai Bund backdrop.
    destinations: [
      { key: 'china', flag: 'cn' },
      { key: 'japan', flag: 'jp' },
      { key: 'spain', flag: 'es' },
      { key: 'france', flag: 'fr' },
      { key: 'italy', flag: 'it' },
      { key: 'global', flag: 'globe' },
    ],
  },

  localization: {
    defaultLocale: 'en',
    locales: {
      en: {
        headline: 'Stay connected',
        headlineSub: 'Wherever you go.',
        ctaText: 'Get your eSIM',
        replayText: 'Play again',
        hookHint: 'Tap to jump',
        meterLabel: 'Signal',
        destinationsLabel: 'Destinations',
        gateBanner: 'Connected in {place}',
        rescueBanner: 'Always On backup data',
        boostBanner: 'High-speed burst',
        orbBanner: 'Unlimited data',
        hazardBanners: {
          roaming: 'Roaming charge',
          wifi: 'Sketchy public Wi-Fi',
          deadzone: 'No coverage here',
          throttle: 'Data cap: throttled',
        },
        currencyGlyph: '$',
        endHeadline: 'Stay connected',
        endHeadlineSub: 'wherever you go.',
        endBody: 'Unlimited data in 200+ destinations, with no roaming fees.',
        statDestinations: 'Destinations',
        statData: 'Data pickups',
        statUptime: 'Connected',
        legalDisclaimer:
          'Holafly is a trademark of Holafly Limited. This game is a stylised illustration of the Holafly app, not actual app footage. Contains in-app purchases.',
        places: { china: 'China', japan: 'Japan', spain: 'Spain', france: 'France', italy: 'Italy', global: 'Global' },
      },
      es: {
        headline: 'Sigue conectado',
        headlineSub: 'Donde vayas.',
        ctaText: 'Consigue tu eSIM',
        replayText: 'Jugar de nuevo',
        hookHint: 'Toca para saltar',
        meterLabel: 'Señal',
        destinationsLabel: 'Destinos',
        gateBanner: 'Conectado en {place}',
        rescueBanner: 'Datos de respaldo Always On',
        boostBanner: 'Ráfaga de alta velocidad',
        orbBanner: 'Datos ilimitados',
        hazardBanners: {
          roaming: 'Cargo de roaming',
          wifi: 'Wi-Fi publico dudoso',
          deadzone: 'Sin cobertura aqui',
          throttle: 'Limite de datos: reducido',
        },
        currencyGlyph: '€',
        endHeadline: 'Sigue conectado',
        endHeadlineSub: 'donde vayas.',
        endBody: 'Datos ilimitados en más de 200 destinos y sin cargos de roaming.',
        statDestinations: 'Destinos',
        statData: 'Datos recogidos',
        statUptime: 'Conectado',
        legalDisclaimer:
          'Holafly es una marca registrada de Holafly Limited. Este juego es una ilustración estilizada de la app de Holafly, no son imágenes reales de la app. Incluye compras dentro de la aplicación.',
        places: { china: 'China', japan: 'Japón', spain: 'España', france: 'Francia', italy: 'Italia', global: 'Global' },
      },
      ja: {
        headline: 'どこでも',
        headlineSub: 'つながる。',
        ctaText: 'eSIMを入手',
        replayText: 'もう一度あそぶ',
        hookHint: 'タップでジャンプ',
        meterLabel: '電波',
        destinationsLabel: '目的地',
        gateBanner: '{place}でも接続中',
        rescueBanner: 'Always On バックアップデータ',
        boostBanner: '高速ブースト',
        orbBanner: 'データ無制限',
        hazardBanners: {
          roaming: 'ローミング料金',
          wifi: '危険な公共Wi-Fi',
          deadzone: '圏外エリア',
          throttle: 'データ上限で速度制限',
        },
        currencyGlyph: '¥',
        endHeadline: '旅先のどこでも',
        endHeadlineSub: 'つながる。',
        endBody: '200以上の国と地域でデータ無制限。ローミング料金はかかりません。',
        statDestinations: '目的地',
        statData: 'データ取得',
        statUptime: '接続率',
        legalDisclaimer:
          'HolaflyはHolafly Limitedの商標です。本ゲームはHolaflyアプリをイメージした演出であり、実際のアプリ画面ではありません。アプリ内課金があります。',
        places: { china: '中国', japan: '日本', spain: 'スペイン', france: 'フランス', italy: 'イタリア', global: 'グローバル' },
      },
      zh: {
        headline: '随时在线',
        headlineSub: '走到哪都联网。',
        ctaText: '获取 eSIM',
        replayText: '再玩一次',
        hookHint: '点击跳跃',
        meterLabel: '信号',
        destinationsLabel: '目的地',
        gateBanner: '在{place}保持连接',
        rescueBanner: 'Always On 备用流量',
        boostBanner: '高速加速',
        orbBanner: '无限流量',
        hazardBanners: {
          roaming: '漫游费',
          wifi: '不安全的公共 Wi-Fi',
          deadzone: '无信号区',
          throttle: '流量封顶已限速',
        },
        currencyGlyph: '¥',
        endHeadline: '走到哪',
        endHeadlineSub: '都保持在线。',
        endBody: '200+ 目的地无限流量,免收漫游费。',
        statDestinations: '目的地',
        statData: '流量拾取',
        statUptime: '在线率',
        legalDisclaimer:
          'Holafly 是 Holafly Limited 的商标。本游戏是对 Holafly 应用的风格化演绎,并非实际应用录屏。含应用内购买。',
        places: { china: '中国', japan: '日本', spain: '西班牙', france: '法国', italy: '意大利', global: '全球' },
      },
    },
  },
};
