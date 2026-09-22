/**
 * S5 ENGINE_BUILD — "Stay Connected Run".
 *
 * Every interactive noun traces to a feature Holafly actually ships, per the
 * S2 anti-fake-ad mapping (RULE-CVR-002):
 *
 *   destination gate   -> 200+ destinations / the app's Short trips list
 *   infinity orb       -> unlimited data, no hidden caps
 *   roaming note       -> the roaming fees Holafly removes
 *   Always On rescue   -> free monthly backup data
 *   piggy pickup       -> the savings framing of "no roaming fees"
 *   rocket             -> high-speed 5G connectivity
 *
 * The signal meter is the spine: it drains as you travel, data refills it,
 * roaming charges cost you, and Always On catches you once. There is no hard
 * fail state, because "you ran out and lost" would be a claim about the
 * product that is not true.
 */
(function (window) {
  'use strict';

  var REF_S = 86; // Tuning reference size; all speeds are expressed at this scale.
  // Shared by the skyline strip and the landmarks so they read as one depth.
  var SKY_PARALLAX = 0.16;
  var SKY_COLOR = 'rgba(198,58,88,0.30)';

  function Game(opts) {
    this.cfg = opts.config;
    this.style = this.cfg.style;
    this.tune = this.cfg.gameplay;
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext('2d');
    this.sprites = opts.sprites;
    this.glyphs = opts.glyphs;
    this.events = opts.events || {};

    this.E = window.PlayableEngine;
    this.art = window.PlayableArt;

    // Indexed once so the hot path never scans the hazard table.
    this._hazardsByKind = {};
    this._hazardWeight = 0;
    (this.tune.hazards || []).forEach(function (hzSpec) {
      this._hazardsByKind[hzSpec.kind] = hzSpec;
      this._hazardWeight += hzSpec.weight;
    }, this);

    this.S = 80;
    this.k = 1;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.groundY = 0;
    this.atlas = null;
    this.backdrop = null;
    this.skylines = {};

    this.pools = {
      hazards: new this.E.Pool(function () {
        return { x: 0, y: 0, active: false, spec: null, spent: false };
      }, 8),
      orbs: new this.E.Pool(function () { return { x: 0, y: 0, active: false, bob: 0 }; }, 10),
      coins: new this.E.Pool(function () { return { x: 0, y: 0, active: false, bob: 0 }; }, 6),
      boosts: new this.E.Pool(function () { return { x: 0, y: 0, active: false, bob: 0 }; }, 4),
      gates: new this.E.Pool(function () { return { x: 0, active: false, flag: 'es', key: 'spain', taken: false }; }, 4),
      landmarks: new this.E.Pool(function () { return { x: 0, active: false, flag: 'globe' }; }, 5),
      particles: new this.E.Pool(function () {
        return { x: 0, y: 0, vx: 0, vy: 0, life: 0, ttl: 1, scale: 1, spin: 0, active: false };
      }, 48),
    };

    this.reset();
  }

  Game.prototype.reset = function () {
    var m = this.tune.meter;
    var r = this.tune.runner;

    this.state = {
      y: 0,
      vy: 0,
      onGround: true,
      airJumps: r.airJumps,
      runPhase: 0,
      speed: r.baseSpeed,
      distance: 0,
      meter: m.startPercent,
      rescuesLeft: m.rescueCount,
      boostUntilMs: -1,
      invulnUntilMs: -1,
      hurtUntilMs: -1,
      throttleUntilMs: -1,
      throttleMultiplier: 1,
      inDeadZone: false,
      zoneStaticMs: 0,
      destinationIndex: 0,
      destinationsCrossed: 0,
      // The country the runner is *in*: the last gate crossed, not
      // `destinationIndex`, which has already advanced to the next gate. The
      // skyline is drawn from this, with `skyFrom`/`skyMix` carrying the
      // crossfade out of the previous city.
      currentFlag: (this.tune.destinations[0] || {}).flag || null,
      skyFrom: null,
      skyMix: 1,
      orbsCollected: 0,
      coinsCollected: 0,
      connectedMs: 0,
      totalMs: 0,
      elapsedMs: 0,
      over: false,
      overReason: null,
      // World x of the finish flag once the last destination has been crossed,
      // null until then. Only ever one, so it does not warrant a pool.
      finishX: null,
    };

    this.timers = {
      gate: this.tune.spawn.firstGateAfterMs,
      hazard: this.tune.spawn.hazardIntervalMs * 1.6,
      orb: this.tune.spawn.orbIntervalMs * 0.8,
      boost: this.tune.spawn.boostIntervalMs,
      coin: this.tune.spawn.coinIntervalMs,
      lastGateMs: -99999,
      landmarkSeeded: false,
      lastLandmarkFlag: null,
    };

    Object.keys(this.pools).forEach(function (key) { this.pools[key].clear(); }, this);
  };

  // ---------------------------------------------------------------- layout

  Game.prototype.layout = function (w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.landscape = w > h * 1.15;

    // One number drives the whole scene's scale. Deriving it from height keeps
    // the runner a constant fraction of the screen, and the width term stops
    // it filling a narrow viewport.
    var s = Math.min(h * (this.landscape ? 0.20 : 0.145), w * 0.175);
    this.S = Math.max(46, Math.min(132, s));
    this.k = this.S / REF_S;
    this.groundY = h * (this.landscape ? 0.845 : 0.842);
    this.runnerX = w * (this.landscape ? 0.18 : 0.22);

    this.atlas = this.art.buildAtlas(this.style, this.S, dpr, this.glyphs);
    this.backdrop = this._buildBackdrop();
    // Cities are cached per flag and keyed off `S`, so a rotation has to
    // drop them rather than rescale stale tiles.
    this.skylines = {};
    this.groundArt = this._buildGround();
  };

  Game.prototype._buildBackdrop = function () {
    var c = this.art.makeCanvas(this.w, this.h, this.dpr);
    var g = c.ctx;
    var grad = g.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, this.style.coralTop);
    grad.addColorStop(1, this.style.coralBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);

    // The low-contrast dotted map texture that sits behind every app surface
    // in the store creative.
    var step = Math.max(9, this.S * 0.16);
    var r = Math.max(0.7, step * 0.075);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (var y = step * 0.5; y < this.h; y += step) {
      var offset = (Math.round(y / step) % 2) * step * 0.5;
      for (var x = offset; x < this.w; x += step) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Ambient four-point sparkles. Static and scattered, exactly how the store
    // creative uses them, and free because they bake into the backdrop.
    var sp = this.atlas && this.atlas.sparkle;
    if (sp) {
      var marks = [
        [0.07, 0.12, 1.00], [0.89, 0.08, 0.60], [0.18, 0.40, 0.52],
        [0.94, 0.33, 0.88], [0.05, 0.60, 0.68], [0.79, 0.53, 0.46],
        [0.44, 0.05, 0.42], [0.63, 0.70, 0.58],
      ];
      for (var i = 0; i < marks.length; i++) {
        var size = sp.w * marks[i][2];
        g.save();
        g.translate(this.w * marks[i][0], this.h * marks[i][1]);
        g.rotate(marks[i][2] * 1.7);
        g.drawImage(sp.canvas, -size / 2, -size / 2, size, size);
        g.restore();
      }
    }
    return c;
  };

  /**
   * One skyline tile per destination, built the first time that country is
   * reached and cached for the rest of the run.
   *
   * Each city is authored as a single tile measured in game units and stamped
   * repeatedly to fill the strip. Sizing the composition off `S` rather than
   * off the viewport is what keeps the buildings the same physical width in
   * portrait and landscape — laying it out in strip fractions made the towers
   * balloon into columns on a wide screen.
   *
   * The tiles are rasterised at 1x regardless of `dpr`: this is a flat
   * silhouette at 30% opacity, so device pixels buy nothing visible, and six
   * cities at 2x on a tall phone would cost tens of megabytes of canvas.
   */
  Game.prototype._skylineFor = function (flag) {
    if (!flag) return null;
    if (this.skylines[flag]) return this.skylines[flag];
    var tileW = this.S * 13;
    // Taller than the city needs, because drawSkyline reserves the top of the
    // strip as headroom for the towers' spires.
    var c = this.art.makeCanvas(tileW, this.S * 2.75, 1);
    this.art.drawSkyline(c.ctx, c.w, c.h, SKY_COLOR, flag);
    this.skylines[flag] = c;
    return c;
  };

  /**
   * Stamps one city across the strip. Called twice while a border crossing is
   * in flight, so the outgoing city dissolves into the incoming one.
   *
   * A dissolve rather than a scroll because the two layers move at different
   * speeds by design: at `SKY_PARALLAX` the horizon needs the better part of a
   * minute to turn over, but a country only lasts a few seconds, so sliding
   * the next city in from the right would leave the runner standing in Paris
   * looking at Shanghai. The near landmark layer is the one that physically
   * travels; at this distance and opacity a crossfade reads as haze.
   */
  Game.prototype._drawSkylineLayer = function (flag, alpha) {
    if (alpha <= 0.004) return;
    var tile = this._skylineFor(flag);
    if (!tile) return;
    var g = this.ctx;
    var y = this.groundY - tile.h + this.S * 0.04;
    g.save();
    g.globalAlpha = alpha;
    for (var x = -((this.state.distance * SKY_PARALLAX) % tile.w); x < this.w; x += tile.w) {
      g.drawImage(tile.canvas, x, y, tile.w, tile.h);
    }
    g.restore();
  };

  Game.prototype._buildGround = function () {
    var gh = this.h - this.groundY;
    var c = this.art.makeCanvas(this.w, gh, this.dpr);
    var g = c.ctx;
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, this.S * 0.07, this.w, gh);
    g.fillStyle = this.style.gold;
    g.fillRect(0, 0, this.w, this.S * 0.07);
    g.fillStyle = 'rgba(41,43,46,0.05)';
    g.fillRect(0, this.S * 0.07, this.w, this.S * 0.02);
    return c;
  };

  // ------------------------------------------------------------- mechanics

  Game.prototype.jump = function () {
    var s = this.state;
    var r = this.tune.runner;
    if (s.over) return false;
    if (s.onGround) {
      s.vy = r.jumpVelocity * this.k;
      s.onGround = false;
      s.airJumps = r.airJumps;
      if (this.events.onJump) this.events.onJump(false);
      return true;
    }
    if (s.airJumps > 0) {
      s.airJumps--;
      s.vy = r.jumpVelocity * this.k * 0.86;
      if (this.events.onJump) this.events.onJump(true);
      return true;
    }
    return false;
  };

  Game.prototype.isBoosting = function () {
    return this.state.elapsedMs < this.state.boostUntilMs;
  };

  Game.prototype.isThrottled = function () {
    return this.state.elapsedMs < this.state.throttleUntilMs;
  };

  /**
   * How fast the signal is bleeding right now, as a multiple of the baseline.
   * Standing in a dead zone and being throttled stack, because in real life a
   * capped plan inside a coverage hole is exactly that bad. A boost suspends
   * both, matching the immunity the hazard collision test already grants.
   */
  Game.prototype.drainMultiplier = function () {
    if (this.isBoosting()) return 1;
    var mult = 1;
    var byKind = this._hazardsByKind;
    if (this.state.inDeadZone && byKind.deadzone) {
      mult *= byKind.deadzone.drainMultiplier;
    }
    if (this.isThrottled()) mult *= this.state.throttleMultiplier;
    return mult;
  };

  /**
   * Forward drag. A coverage hole is the one hazard you stand in rather than
   * get hit by, so it is the one that can push back physically: the runner
   * bogs down, which both reads as resistance and extends the exposure you
   * are being charged for. Clearing it with a jump skips the drag entirely,
   * which is the same skill test the collision box already sets.
   */
  Game.prototype.speedMultiplier = function () {
    if (this.isBoosting()) return 1;
    var spec = this._hazardsByKind.deadzone;
    if (this.state.inDeadZone && spec && spec.speedMultiplier) return spec.speedMultiplier;
    return 1;
  };

  Game.prototype._emit = function (name, payload) {
    if (this.events[name]) this.events[name](payload);
  };

  /** `y` is a height above the ground line, not a screen coordinate: the
   *  particle integrator and the renderer both treat +y as up. */
  Game.prototype._burst = function (x, y, count, kind) {
    for (var i = 0; i < count; i++) {
      var p = this.pools.particles.spawn();
      if (!p) return;
      var a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      var sp = this.S * (1.1 + Math.random() * 1.9);
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp + this.S * 0.9;
      p.life = 0;
      p.ttl = 0.42 + Math.random() * 0.34;
      p.scale = 0.5 + Math.random() * 0.8;
      // Interference dashes stay level; everything else tumbles.
      p.spin = kind === 'static' ? 0 : (Math.random() - 0.5) * 8;
      p.kind = kind;
    }
  };

  Game.prototype.update = function (dt, elapsedMs) {
    var s = this.state;
    var m = this.tune.meter;
    var r = this.tune.runner;
    var sp = this.tune.spawn;
    if (s.over) return;

    s.elapsedMs = elapsedMs;
    s.totalMs += dt * 1000;
    if (s.meter > 0) s.connectedMs += dt * 1000;
    if (s.skyMix < 1) {
      s.skyMix = Math.min(1, s.skyMix + (dt * 1000) / sp.skylineFadeMs);
      if (s.skyMix >= 1) s.skyFrom = null;
    }

    // Speed ramps, then a boost multiplies whatever it has reached and a dead
    // zone drags it back down. Both read the zone state resolved at the end of
    // the previous frame, the same 16ms lag the drain accepts.
    var base = Math.min(r.maxSpeed, r.baseSpeed + r.speedRampPerSecond * (elapsedMs / 1000));
    s.speed = base * (this.isBoosting() ? r.boostMultiplier : 1) * this.speedMultiplier();
    var vx = s.speed * this.k;
    s.distance += vx * dt;

    // Runner physics.
    if (!s.onGround) {
      s.vy -= r.gravity * this.k * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) {
        s.y = 0;
        s.vy = 0;
        s.onGround = true;
        s.airJumps = r.airJumps;
      }
    }
    // Leg cycle follows the drag, so a dragged runner looks like it is wading
    // rather than sprinting on the spot.
    s.runPhase = (s.runPhase + dt * (this.isBoosting() ? 13 : 9.5) * this.speedMultiplier()) % 1;

    // Meter drain, and the Always On rescue. The multiplier reflects the zone
    // overlap resolved at the end of the previous frame, which is a 16ms lag
    // nobody can perceive and avoids resolving collisions twice.
    s.meter -= m.drainPerSecond * this.drainMultiplier() * dt;
    if (s.meter <= 0) {
      if (s.rescuesLeft > 0) {
        s.rescuesLeft--;
        s.meter = m.rescueRefill;
        s.invulnUntilMs = elapsedMs + 1200;
        this._emit('onRescue');
        this._burst(this.runnerX, this.S * 0.7, 14, 'green');
      } else {
        s.meter = 0;
        this.end('signal');
        return;
      }
    }
    if (s.meter > 100) s.meter = 100;
    this._emit('onMeter', s.meter);

    this._spawn(dt, elapsedMs);
    this._advance(vx, dt, elapsedMs);

    if (elapsedMs >= this.tune.maxGameplayDurationMs) this.end('timeout');
  };

  /**
   * Places one country's landmark in the world. Refuses to repeat the flag it
   * placed last, so a config with two consecutive entries for the same country
   * — which is exactly what the seeded opening plus the first gate would be —
   * does not stand two identical landmarks next to each other.
   */
  Game.prototype._spawnLandmark = function (flag, x) {
    if (this.timers.lastLandmarkFlag === flag) return;
    if (!this.atlas || !this.atlas.landmarks[flag]) return;
    var lm = this.pools.landmarks.spawn();
    if (!lm) return;
    lm.x = x;
    lm.flag = flag;
    this.timers.lastLandmarkFlag = flag;
  };

  /** Weighted draw from the hazard table, so the mix is a config decision. */
  Game.prototype._pickHazard = function () {
    var specs = this.tune.hazards;
    var roll = Math.random() * this._hazardWeight;
    for (var i = 0; i < specs.length; i++) {
      roll -= specs[i].weight;
      if (roll <= 0) return specs[i];
    }
    return specs[specs.length - 1];
  };

  Game.prototype._spawn = function (dt, elapsedMs) {
    var sp = this.tune.spawn;
    var t = this.timers;
    var step = dt * 1000;
    var spawnX = this.w + this.S * 1.4;

    // The opening scene is Shanghai, so the first country's landmark is on
    // screen from the first frame rather than drifting in later. Seeded here
    // instead of in reset() because the viewport is not known that early.
    if (!t.landmarkSeeded) {
      t.landmarkSeeded = true;
      this._spawnLandmark(this.tune.destinations[0].flag, this.w * 0.44);
    }

    // Once the finish flag is placed the run is on its victory lap: no new
    // borders to cross, and nothing left that can kill you a second from the
    // ending. A cheap death there reads as a rigged ad.
    if (this.state.finishX !== null) return;

    t.gate -= step;
    if (t.gate <= 0) {
      var g = this.pools.gates.spawn();
      if (g) {
        var dest = this.tune.destinations[this.state.destinationIndex % this.tune.destinations.length];
        g.x = spawnX + this.S * 1.2;
        g.flag = dest.flag;
        g.key = dest.key;
        g.taken = false;
        t.lastGateMs = elapsedMs;
        // Born off the right edge at the same moment as its gate, so the next
        // country appears on the horizon before you reach its border and then
        // drifts past you. That handoff is the whole point: nothing on screen
        // ever changes what it is, it only travels.
        this._spawnLandmark(dest.flag, this.w + this.S * 0.6);
      }
      t.gate = sp.gateIntervalMs;
    }

    // Nothing spawns right on top of a gate: the gate is the story beat and it
    // has to be readable.
    var nearGate = Math.abs(elapsedMs - t.lastGateMs) < sp.minGapFromGateMs;

    t.hazard -= step;
    if (t.hazard <= 0 && !nearGate) {
      var hz = this.pools.hazards.spawn();
      if (hz) {
        hz.x = spawnX;
        hz.y = 0;
        hz.spec = this._pickHazard();
        hz.spent = false;
      }
      t.hazard = sp.hazardIntervalMs * (0.82 + Math.random() * 0.42);
    }

    t.orb -= step;
    if (t.orb <= 0) {
      var o = this.pools.orbs.spawn();
      if (o) {
        o.x = spawnX;
        // Above standing reach (the runner is 1.02S tall) and inside a single
        // jump's apex of ~2.65S. Refilling the meter has to cost a tap,
        // otherwise a passive viewer coasts to the endcard on free data and
        // the whole "stay connected" mechanic says nothing.
        o.y = this.S * (1.35 + Math.random() * 1.3);
        o.bob = Math.random() * Math.PI * 2;
      }
      t.orb = sp.orbIntervalMs * (0.85 + Math.random() * 0.4);
    }

    t.coin -= step;
    if (t.coin <= 0) {
      var cn = this.pools.coins.spawn();
      if (cn) { cn.x = spawnX; cn.y = this.S * 0.62; cn.bob = Math.random() * Math.PI * 2; }
      t.coin = sp.coinIntervalMs * (0.85 + Math.random() * 0.4);
    }

    t.boost -= step;
    if (t.boost <= 0 && !nearGate) {
      var b = this.pools.boosts.spawn();
      if (b) { b.x = spawnX; b.y = this.S * 1.45; b.bob = Math.random() * Math.PI * 2; }
      t.boost = sp.boostIntervalMs * (0.9 + Math.random() * 0.3);
    }
  };

  Game.prototype._advance = function (vx, dt, elapsedMs) {
    var s = this.state;
    var m = this.tune.meter;
    var sp = this.tune.spawn;
    var self = this;
    var dx = vx * dt;
    var cull = -this.S * 3.2;

    // Runner hitbox, generously inset. A playable that feels unfair in 30
    // seconds converts worse than one that feels generous.
    var rx0 = this.runnerX - this.S * 0.24;
    var rx1 = this.runnerX + this.S * 0.24;
    var ry0 = s.y;
    var ry1 = s.y + this.S * 1.02;

    var overlap = function (ex0, ex1, ey0, ey1) {
      return rx0 < ex1 && rx1 > ex0 && ry0 < ey1 && ry1 > ey0;
    };

    this.pools.gates.each(function (g) {
      g.x -= dx;
      if (!g.taken && g.x <= self.runnerX) {
        g.taken = true;
        s.destinationsCrossed++;
        s.destinationIndex++;
        if (g.flag && g.flag !== s.currentFlag) {
          s.skyFrom = s.currentFlag;
          s.skyMix = 0;
          s.currentFlag = g.flag;
        }
        s.meter = Math.min(100, s.meter + m.gateRefill);
        self._emit('onGate', g.key);
        self._burst(self.runnerX, self.S * 1.5, 10, 'yellow');

        // Last destination: plant the finish flag ahead so the run ends on
        // arriving somewhere rather than on the clock running out.
        //
        // The lead is clamped to the time actually left on the cap. Gates are
        // scheduled by spawn time but crossed one to two seconds later while
        // they travel in, so how much room is left here depends on the gate
        // cadence; without the clamp a slow cadence would plant a flag that
        // can never be reached, and the run would end staring at it.
        if (s.finishX === null && s.destinationsCrossed >= self.tune.destinations.length) {
          var leftMs = self.tune.maxGameplayDurationMs - elapsedMs - 250;
          var lead = Math.min(sp.finishLeadSeconds, leftMs / 1000);
          if (lead >= 0.4) {
            s.finishX = self.runnerX + vx * lead;
            // Retire hazards the player has not seen yet. Suppressing new
            // spawns is not enough on its own: one already in flight arrives
            // inside the victory lap, and losing to it a second from the flag
            // reads as a rigged ad. Anything already on screen stays — it has
            // been visible long enough to react to, and pulling it would look
            // like the obstacle blinked out.
            self.pools.hazards.each(function (hz) {
              if (hz.x > self.w) hz.active = false;
            });
          }
        }
      }
      if (g.x < cull - self.S * 2) g.active = false;
    });

    // Scenery drifts at the skyline's parallax rate so the two layers stay
    // locked to each other, and is culled once fully past the left edge.
    var lmW = this.atlas.landmarks.globe.w;
    this.pools.landmarks.each(function (lm) {
      lm.x -= dx * SKY_PARALLAX;
      if (lm.x < -lmW) lm.active = false;
    });

    // The victory lap. Reaching the flag is x-only on purpose: you cannot
    // jump the finish, and a player who happens to be mid-air or wading a
    // dead zone when it arrives still gets the ending they earned.
    if (s.finishX !== null) {
      s.finishX -= dx;
      if (s.finishX <= this.runnerX) {
        s.finishX = this.runnerX;
        this._burst(this.runnerX, this.S * 1.9, 26, 'yellow');
        this.end('finish');
        return;
      }
    }

    // Zone overlap is recomputed from scratch every frame: you are only inside
    // a coverage hole while you are actually inside it.
    var inZone = false;

    this.pools.hazards.each(function (hz) {
      hz.x -= dx;
      if (hz.x < cull) { hz.active = false; return; }

      var spec = hz.spec;
      var zone = spec.effect === 'zone';
      // Dead zones are wide and low; point hazards are compact. The width is
      // set so one jump just clears the zone — that is the skill test.
      var halfW = zone ? self.S * 1.25 : self.S * 0.3;
      var top = zone ? self.S * 0.66 : self.S * 0.52;
      var hit = overlap(hz.x - halfW, hz.x + halfW, 0, top);
      if (!hit) return;

      if (zone) {
        // No consumption and no invulnerability window: a coverage hole keeps
        // costing you for as long as you are standing in it.
        if (!self.isBoosting()) {
          inZone = true;
          if (!hz.spent) {
            hz.spent = true;
            self._emit('onHazard', spec.kind);
          }
        }
        return;
      }

      if (elapsedMs < s.invulnUntilMs || self.isBoosting()) return;
      hz.active = false;
      s.invulnUntilMs = elapsedMs + 900;
      s.hurtUntilMs = elapsedMs + 260;

      if (spec.effect === 'debuff') {
        s.throttleUntilMs = elapsedMs + spec.durationMs;
        s.throttleMultiplier = spec.drainMultiplier;
      } else {
        // Floored above zero so a single hit can never be the thing that ends
        // the run; only sustained neglect of the meter does that.
        s.meter = Math.max(0.01, s.meter - spec.penalty);
      }

      self._emit('onHazard', spec.kind);
      self._burst(hz.x, self.S * 0.4, 9, 'red');
    });

    if (inZone !== s.inDeadZone) {
      s.inDeadZone = inZone;
      s.zoneStaticMs = 0;
      // Separate from `onHazard`, which fires once per zone to raise the
      // banner. This one brackets the whole stay so the HUD and the audio
      // crackle have an off switch as well as an on switch.
      this._emit('onZone', inZone);
    }

    // Interference fizzing off the runner while the signal is gone. Emitted
    // on a fixed cadence rather than per frame so the density does not track
    // the frame rate.
    if (inZone) {
      var zoneSpec = this._hazardsByKind.deadzone;
      var every = (zoneSpec && zoneSpec.staticIntervalMs) || 90;
      s.zoneStaticMs += dt * 1000;
      while (s.zoneStaticMs >= every) {
        s.zoneStaticMs -= every;
        this._burst(this.runnerX, this.S * (0.4 + Math.random() * 0.8), 3, 'static');
      }
    }

    this.pools.orbs.each(function (o) {
      o.x -= dx;
      o.bob += dt * 3.1;
      if (o.x < cull) { o.active = false; return; }
      var oy = o.y + Math.sin(o.bob) * self.S * 0.09;
      if (overlap(o.x - self.S * 0.3, o.x + self.S * 0.3, oy - self.S * 0.22, oy + self.S * 0.22)) {
        o.active = false;
        s.orbsCollected++;
        s.meter = Math.min(100, s.meter + m.orbRefill);
        self._emit('onOrb');
        self._burst(o.x, oy, 8, 'yellow');
      }
    });

    this.pools.coins.each(function (cn) {
      cn.x -= dx;
      cn.bob += dt * 2.6;
      if (cn.x < cull) { cn.active = false; return; }
      var cy = cn.y + Math.sin(cn.bob) * self.S * 0.07;
      if (overlap(cn.x - self.S * 0.28, cn.x + self.S * 0.28, cy - self.S * 0.26, cy + self.S * 0.26)) {
        cn.active = false;
        s.coinsCollected++;
        self._emit('onCoin');
        self._burst(cn.x, cy, 7, 'yellow');
      }
    });

    this.pools.boosts.each(function (b) {
      b.x -= dx;
      b.bob += dt * 2.2;
      if (b.x < cull) { b.active = false; return; }
      var by = b.y + Math.sin(b.bob) * self.S * 0.1;
      if (overlap(b.x - self.S * 0.3, b.x + self.S * 0.3, by - self.S * 0.34, by + self.S * 0.34)) {
        b.active = false;
        s.boostUntilMs = elapsedMs + self.tune.runner.boostDurationMs;
        self._emit('onBoost');
        self._burst(b.x, by, 12, 'blue');
      }
    });

    this.pools.particles.each(function (p) {
      p.life += dt;
      if (p.life >= p.ttl) { p.active = false; return; }
      p.x += p.vx * dt - dx * 0.55;
      p.y += p.vy * dt;
      p.vy -= self.S * 17 * dt;
    });
  };

  Game.prototype.end = function (reason) {
    if (this.state.over) return;
    this.state.over = true;
    this.state.overReason = reason;
    this._emit('onEnd', {
      reason: reason,
      destinations: this.state.destinationsCrossed,
      orbs: this.state.orbsCollected,
      coins: this.state.coinsCollected,
      uptime: this.state.totalMs > 0
        ? Math.round((this.state.connectedMs / this.state.totalMs) * 100)
        : 100,
    });
  };

  // ---------------------------------------------------------------- render

  Game.prototype._blit = function (art, x, y) {
    var p = art.pad || 0;
    this.ctx.drawImage(art.canvas, x - p, y - p, art.w, art.h);
  };

  Game.prototype.render = function () {
    var g = this.ctx;
    var s = this.state;
    var S = this.S;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._blit(this.backdrop, 0, 0);

    // Parallax skyline, mid-crossfade if the runner just changed country. The
    // two layers are over-driven slightly: opacity composites multiplicatively,
    // so a straight 50/50 dissolve leaves the whole horizon at half strength
    // for the duration and reads as a dip in the art rather than a handover.
    this._drawSkylineLayer(s.skyFrom, Math.min(1, (1 - s.skyMix) * 1.25));
    this._drawSkylineLayer(s.currentFlag, Math.min(1, s.skyMix * 1.25));

    // Country landmarks, standing in the skyline. Each one is a discrete piece
    // of scenery travelling through the world, so crossing a border shows the
    // old country leaving on the left and the new one arriving on the right
    // instead of one building silently becoming another in place.
    var selfR = this;
    this.pools.landmarks.each(function (lm) {
      var art = selfR.atlas.landmarks[lm.flag];
      if (!art) return;
      g.drawImage(art.canvas, lm.x, selfR.groundY - art.h + S * 0.05, art.w, art.h);
    });

    // Clouds.
    g.globalAlpha = 0.72;
    for (var i = 0; i < this.atlas.clouds.length; i++) {
      var cl = this.atlas.clouds[i];
      var span = this.w + cl.w;
      var cx = ((-s.distance * (0.22 + i * 0.09)) % span + span) % span;
      var cy = this.h * (0.07 + i * 0.13);
      g.drawImage(cl.canvas, this.w - cx, cy, cl.w, cl.h);
      g.drawImage(cl.canvas, this.w - cx - span, cy, cl.w, cl.h);
    }
    g.globalAlpha = 1;

    var self = this;

    // Gates sit behind the runner so passing through reads as passing through.
    this.pools.gates.each(function (gt) {
      var art = self.atlas.gates[gt.flag];
      if (!art) return;
      self._blit(art, gt.x - art.w / 2, self.groundY - art.h);
    });

    // The finish flag shares the gates' layer: the runner reaches it by
    // passing it, not by stopping in front of it.
    if (s.finishX !== null) {
      var vf = this.atlas.victoryFlag;
      var vfPad = vf.pad || 0;
      var vfH = vf.h - vfPad * 2;
      this._glow(s.finishX, this.groundY - vfH * 0.74, S * 1.5, 'rgba(255,246,32,0.5)');
      this._blit(vf, s.finishX - (vf.w - vfPad * 2) * 0.30, this.groundY - vfH);
    }

    this._blit(this.groundArt, 0, this.groundY);
    this._renderRoute();

    // Pickups and hazards.
    this.pools.hazards.each(function (hz) {
      var art = self.atlas.hazards[hz.spec.kind];
      if (!art) return;
      var pad = art.pad || 0;
      var artW = art.w - pad * 2;
      var artH = art.h - pad * 2;
      // Dead zones sit on the ground line; point hazards float slightly, the
      // way the store creative floats its stickers.
      var lift = hz.spec.effect === 'zone' ? 0 : S * 0.1;
      self._blit(art, hz.x - artW / 2, self.groundY - artH - lift);
    });

    this.pools.orbs.each(function (o) {
      var sprite = self.sprites.orbUnlimited;
      if (!sprite) return;
      var ow = S * 0.82;
      var oh = ow * (sprite.naturalHeight / sprite.naturalWidth);
      var oy = self.groundY - (o.y + Math.sin(o.bob) * S * 0.09);
      self._glow(o.x, oy, ow * 0.85, 'rgba(255,246,32,0.40)');
      g.drawImage(sprite, o.x - ow / 2, oy - oh / 2, ow, oh);
    });

    this.pools.coins.each(function (cn) {
      var sprite = self.sprites.coinSavings;
      if (!sprite) return;
      var cw = S * 0.68;
      var ch = cw * (sprite.naturalHeight / sprite.naturalWidth);
      var cy = self.groundY - (cn.y + Math.sin(cn.bob) * S * 0.07);
      self._glow(cn.x, cy, cw * 0.8, 'rgba(255,246,32,0.30)');
      g.drawImage(sprite, cn.x - cw / 2, cy - ch / 2, cw, ch);
    });

    this.pools.boosts.each(function (b) {
      var by = self.groundY - (b.y + Math.sin(b.bob) * S * 0.1);
      self._glow(b.x, by, S * 0.55, 'rgba(191,235,255,0.5)');
      self._blit(self.atlas.rocket, b.x - self.atlas.rocket.w / 2 + (self.atlas.rocket.pad || 0),
        by - self.atlas.rocket.h / 2 + (self.atlas.rocket.pad || 0));
    });

    if (this.isBoosting()) this._renderSpeedLines();

    // Runner.
    var art;
    if (s.elapsedMs < s.hurtUntilMs) art = this.atlas.hurt;
    else if (!s.onGround) art = this.atlas.jump;
    else art = this.atlas.run[Math.floor(s.runPhase * this.atlas.run.length) % this.atlas.run.length];

    var blink = s.elapsedMs < s.invulnUntilMs && Math.floor(s.elapsedMs / 90) % 2 === 0;
    g.globalAlpha = blink ? 0.55 : 1;
    // Losing coverage makes the runner stutter, the way a dropped frame of
    // video does. Sub-pixel amounts on purpose: any larger and it stops
    // looking like interference and starts looking like a bug.
    var jitter = s.inDeadZone ? (Math.random() - 0.5) * S * 0.055 : 0;
    this._blit(art, this.runnerX - S / 2 + jitter, this.groundY - s.y - S * 1.22);
    g.globalAlpha = 1;

    if (s.inDeadZone) this._renderSignalLoss();

    // Particles on top of everything.
    this.pools.particles.each(function (p) {
      var t = p.life / p.ttl;
      var sz = self.atlas.sparkle.w * p.scale * (1 - t * 0.45);
      g.save();
      g.globalAlpha = 1 - t;
      g.translate(p.x, self.groundY - p.y);
      g.rotate(p.spin * p.life);
      if (p.kind === 'static') {
        // Short horizontal dashes, not sparkles: this is torn signal, and it
        // must not be mistaken for a reward.
        g.fillStyle = 'rgba(226,232,240,0.85)';
        g.fillRect(-sz * 0.26, -sz * 0.05, sz * 0.52, Math.max(1, sz * 0.1));
      } else if (p.kind === 'red' || p.kind === 'blue' || p.kind === 'green') {
        g.fillStyle = p.kind === 'red' ? self.style.primaryColor
          : p.kind === 'blue' ? '#BFEBFF' : self.style.accentGreen;
        g.beginPath();
        g.arc(0, 0, sz * 0.18, 0, Math.PI * 2);
        g.fill();
      } else {
        g.drawImage(self.atlas.sparkle.canvas, -sz / 2, -sz / 2, sz, sz);
      }
      g.restore();
    });
  };

  Game.prototype._glow = function (x, y, r, color) {
    var g = this.ctx;
    var grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  /** The app's dotted travel line, scrolling under the runner's feet. */
  Game.prototype._renderRoute = function () {
    var g = this.ctx;
    var S = this.S;
    var y = this.groundY + S * 0.30;
    var gap = S * 0.42;
    var offset = (this.state.distance % gap);
    g.fillStyle = 'rgba(41,43,46,0.16)';
    for (var x = -offset; x < this.w + gap; x += gap) {
      g.beginPath();
      g.arc(x, y, S * 0.035, 0, Math.PI * 2);
      g.fill();
    }
  };

  /**
   * What "no coverage" looks like from inside it. Three layers, all plain
   * fills so the cost is a few draw calls and no atlas: a desaturating wash,
   * interference bands scrolling at a rate unrelated to the world so they
   * read as noise rather than scenery, and a vignette closing in. Deliberately
   * kept translucent — the runner and the hazard both have to stay legible,
   * because the player is still expected to jump their way out.
   */
  Game.prototype._renderSignalLoss = function () {
    var g = this.ctx;
    var w = this.w;
    var h = this.h;
    var S = this.S;
    var t = this.state.elapsedMs / 1000;

    g.save();
    g.fillStyle = 'rgba(94,104,120,0.26)';
    g.fillRect(0, 0, w, h);

    var band = Math.max(3, S * 0.075);
    var offset = (t * S * 2.6) % (band * 2);
    g.fillStyle = 'rgba(255,255,255,0.055)';
    for (var y = -offset; y < h; y += band * 2) g.fillRect(0, y, w, band);

    // The single brighter tear sweeping down the screen is the whole reason
    // the effect reads as a signal drop and not as fog.
    var tear = ((t * 1.15) % 1) * (h + S) - S * 0.5;
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(0, tear, w, S * 0.13);

    var grad = g.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.3,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(41,43,46,0)');
    grad.addColorStop(1, 'rgba(41,43,46,0.46)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.restore();
  };

  Game.prototype._renderSpeedLines = function () {
    var g = this.ctx;
    var S = this.S;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var y = this.groundY - S * (0.25 + i * 0.32);
      var phase = ((this.state.distance * 2.4 + i * 137) % (this.w + S * 4));
      var x = this.w + S * 2 - phase;
      g.lineWidth = S * 0.028;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + S * (0.5 + (i % 3) * 0.28), y);
      g.stroke();
    }
  };

  Game.prototype.destroy = function () {
    this.atlas = null;
    this.backdrop = null;
    this.skylines = {};
    this.groundArt = null;
    Object.keys(this.pools).forEach(function (key) { this.pools[key].clear(); }, this);
  };

  window.PlayableGame = Game;
})(window);
