/* overhead.js: the sky over Toronto, as sound. v2, 2026-11-02 (comments brought up to date 2026-11-27).
 *
 * Loaded by the sky page (/sky/) the first time its sound panel opens. It
 * calls Overhead.mount(container, options) and gets a card: a button, a
 * spectrogram, the list of aircraft within earshot, and a few controls (the
 * sky page shows only the button and the status line).
 *
 * What it does. Every few seconds it reads /overhead/now.json, which the box
 * publishes from public ADS-B transponder data: every aircraft within 55 km
 * of downtown Toronto, with ~100 s of track each. For the listener's position
 * it then plays each aircraft as it would be heard there:
 *   - the sound you hear at time t left the aircraft at an earlier time tau,
 *     with t = tau + distance(tau) / c. That emission time is solved for
 *     every tick; using the present position instead gives the wrong curve,
 *     not a late one;
 *   - the pitch is f0 * c / (c + v_r), with v_r the velocity along the line
 *     of sight at the emission time (positive = moving away), so the note
 *     slides down as the plane passes: the Doppler curve;
 *   - f0 is the blade-pass frequency of the propeller or rotor (blades x
 *     rpm / 60) for props and helicopters, from a small table by ICAO type;
 *     jets are filtered noise whose playback rate carries the same shift;
 *   - loudness falls as 1/distance, the air takes the highs with distance
 *     (a lowpass that closes as the plane gets farther), and planes low on
 *     the horizon are quieter still.
 * The engine sounds are synthesized; the aircraft, their tracks and the
 * Doppler shift are real. Positions reach the page already public; the
 * circle is the same for everyone, and a visitor's own location, if they
 * share it, never leaves the page.
 *
 * Two pages open at once: the first one to start keeps the planes, the other
 * mutes its copy and says so (BroadcastChannel), so the sky is never doubled.
 *
 * Deploy: scp to the web root. Bump ?v= where the sky page loads it (bootSound
 * in sky/index.html) when this file changes; Cloudflare caches .js for hours.
 */
(function (global) {
  'use strict';

  const C = 340;                     // speed of sound, m/s
  const EARSHOT = 16000;             // m; beyond this an aircraft is not voiced
  const POLL_MS = 5000;
  const TICK_MS = 100;
  const EXTRAP_S = 30;               // dead-reckon this long past the last fix, then let go
  const DEFAULT_LISTENER = { lat: 43.65, lon: -79.38, alt: 100, name: 'downtown Toronto' };
  const D2R = Math.PI / 180;
  const STORE = 'overhead:v1';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Propellers: [blades, rpm at full power, rpm in cruise, engines, source level]
  // Blade-pass frequency = blades * rpm / 60. Full power is used while climbing.
  const PROPS = {
    DH8D: [6, 1020, 850, 2, 0.8], DH8A: [4, 1200, 900, 2, 0.7], DH8B: [4, 1200, 900, 2, 0.7], DH8C: [4, 1200, 900, 2, 0.7],
    AT72: [6, 1200, 980, 2, 0.7], AT75: [6, 1200, 980, 2, 0.7], AT76: [6, 1200, 980, 2, 0.7], AT43: [6, 1200, 980, 2, 0.65], AT45: [6, 1200, 980, 2, 0.65], AT46: [6, 1200, 980, 2, 0.65],
    SF34: [4, 1396, 1100, 2, 0.7], JS41: [5, 1591, 1300, 2, 0.6], JS31: [4, 1591, 1300, 2, 0.6], JS32: [4, 1591, 1300, 2, 0.6], J328: [6, 1300, 1100, 2, 0.6], D228: [4, 1600, 1400, 2, 0.6],
    DHC6: [3, 2200, 1900, 2, 0.6], DHC7: [4, 1210, 1000, 4, 0.7], DH2T: [3, 2200, 1900, 1, 0.5], DH3T: [3, 1900, 1800, 1, 0.5], E120: [4, 1700, 1500, 2, 0.6], B190: [4, 1700, 1500, 2, 0.6],
    BE99: [3, 2200, 1900, 2, 0.6], SW4: [4, 1591, 1400, 2, 0.6], SW3: [3, 2000, 1800, 2, 0.6], C212: [4, 2000, 1800, 2, 0.6], AN26: [4, 1240, 1240, 2, 0.75], AN12: [4, 1075, 1075, 4, 0.9],
    C130: [4, 1021, 1021, 4, 0.9], C30J: [6, 1021, 1021, 4, 0.9], P3: [4, 1021, 1021, 4, 0.9], A400: [8, 842, 842, 4, 0.9], DC3: [3, 1200, 1200, 2, 0.8], CVLT: [4, 1200, 1100, 2, 0.75],
    BE20: [4, 2000, 1700, 2, 0.55], B350: [4, 1700, 1500, 2, 0.55], BE30: [4, 1700, 1500, 2, 0.55], BE9L: [3, 2200, 2000, 2, 0.5], BE9T: [3, 2200, 2000, 2, 0.5], BE10: [4, 2000, 1800, 2, 0.5],
    PC12: [4, 1700, 1700, 1, 0.5], PC6T: [3, 2200, 2000, 1, 0.5], TBM7: [4, 2000, 2000, 1, 0.5], TBM8: [4, 2000, 2000, 1, 0.5], TBM9: [5, 2000, 2000, 1, 0.5], C208: [3, 1900, 1600, 1, 0.5],
    KODI: [4, 2200, 2000, 1, 0.5], PA46: [4, 2000, 2000, 1, 0.45], P46T: [4, 2000, 2000, 1, 0.45], AC90: [4, 2000, 1800, 2, 0.55], AC95: [4, 2000, 1800, 2, 0.55], MU2: [4, 1591, 1591, 2, 0.55],
    E110: [4, 2000, 1800, 2, 0.55], PAY2: [4, 2000, 1800, 2, 0.5], PAY3: [4, 2000, 1800, 2, 0.5], PAY4: [4, 2000, 1800, 2, 0.5], AT8T: [4, 2200, 2000, 1, 0.5], AT6T: [4, 2200, 2000, 1, 0.5],
    C425: [3, 2000, 1800, 2, 0.5], C441: [3, 2000, 1800, 2, 0.5], EVOT: [4, 2000, 2000, 1, 0.45], PC21: [5, 2000, 2000, 1, 0.5], T6: [4, 2200, 2000, 1, 0.5],
    C172: [2, 2500, 2350, 1, 0.3], C152: [2, 2500, 2350, 1, 0.25], C150: [2, 2500, 2350, 1, 0.25], C162: [2, 2500, 2350, 1, 0.25], C170: [2, 2500, 2350, 1, 0.28], C175: [2, 2500, 2350, 1, 0.28],
    C177: [2, 2600, 2400, 1, 0.3], C180: [2, 2600, 2400, 1, 0.3], C182: [3, 2400, 2300, 1, 0.32], C185: [3, 2600, 2400, 1, 0.32], C206: [3, 2600, 2400, 1, 0.33], C207: [3, 2600, 2400, 1, 0.33],
    C210: [3, 2600, 2400, 1, 0.33], P28A: [2, 2500, 2350, 1, 0.3], P28B: [2, 2500, 2350, 1, 0.3], P28R: [2, 2600, 2400, 1, 0.3], P28T: [3, 2600, 2400, 1, 0.3], PA18: [2, 2500, 2350, 1, 0.28],
    PA22: [2, 2500, 2350, 1, 0.28], PA24: [2, 2600, 2400, 1, 0.3], PA32: [3, 2600, 2400, 1, 0.33], P32R: [3, 2600, 2400, 1, 0.33], P32T: [3, 2600, 2400, 1, 0.33], PA38: [2, 2500, 2350, 1, 0.25],
    SR20: [3, 2600, 2400, 1, 0.3], SR22: [3, 2600, 2400, 1, 0.32], S22T: [3, 2600, 2400, 1, 0.32], DA40: [3, 2400, 2200, 1, 0.28], DV20: [2, 2400, 2200, 1, 0.25], DA20: [2, 2400, 2200, 1, 0.25],
    BE33: [2, 2600, 2400, 1, 0.3], BE35: [2, 2600, 2400, 1, 0.3], BE36: [3, 2600, 2400, 1, 0.32], M20P: [2, 2600, 2400, 1, 0.3], M20T: [3, 2600, 2400, 1, 0.3], RV4: [2, 2600, 2400, 1, 0.3],
    RV6: [2, 2600, 2400, 1, 0.3], RV7: [2, 2600, 2400, 1, 0.3], RV8: [2, 2600, 2400, 1, 0.3], RV9: [2, 2600, 2400, 1, 0.3], RV10: [3, 2600, 2400, 1, 0.3], RV12: [2, 2300, 2100, 1, 0.25],
    AA5: [2, 2600, 2400, 1, 0.28], G115: [2, 2600, 2400, 1, 0.28], CH7A: [2, 2500, 2300, 1, 0.26], CH7B: [2, 2500, 2300, 1, 0.26], J3: [2, 2300, 2100, 1, 0.25], PTS2: [2, 2600, 2400, 1, 0.35],
    T34: [2, 2600, 2400, 1, 0.32], BL8: [2, 2600, 2400, 1, 0.3], GLAS: [3, 2600, 2400, 1, 0.32], LNC2: [3, 2600, 2400, 1, 0.32], COL3: [3, 2600, 2400, 1, 0.32], COL4: [3, 2600, 2400, 1, 0.32],
    PA34: [2, 2600, 2400, 2, 0.4], PA44: [2, 2600, 2400, 2, 0.4], PA30: [2, 2600, 2400, 2, 0.4], PA31: [3, 2500, 2300, 2, 0.45], PA23: [2, 2600, 2400, 2, 0.4], BE55: [2, 2700, 2400, 2, 0.4],
    BE58: [3, 2700, 2400, 2, 0.45], BE76: [2, 2700, 2400, 2, 0.4], BE60: [3, 2500, 2300, 2, 0.45], C310: [3, 2600, 2400, 2, 0.45], C340: [3, 2600, 2400, 2, 0.45], C402: [3, 2600, 2400, 2, 0.45],
    C404: [3, 2600, 2400, 2, 0.45], C414: [3, 2600, 2400, 2, 0.45], C421: [3, 2600, 2400, 2, 0.45], C303: [3, 2600, 2400, 2, 0.45], DA42: [3, 2300, 2100, 2, 0.38], DA62: [3, 2300, 2100, 2, 0.38],
    P06T: [2, 2400, 2200, 2, 0.35], P68: [2, 2600, 2400, 2, 0.4], AEST: [3, 2600, 2400, 2, 0.45], BE18: [2, 2300, 2100, 2, 0.5]
  };
  // Helicopters: [main blades, main rpm, tail blades, tail rpm]
  const HELIS = {
    AS50: [3, 390, 2, 2086], AS55: [3, 390, 2, 2086], EC30: [3, 394, 10, 3584], EC20: [3, 410, 8, 3900], EC35: [4, 395, 10, 3584], EC45: [4, 383, 2, 2169], EC55: [4, 348, 10, 3300],
    EC75: [5, 348, 10, 3300], H60: [4, 258, 4, 1190], S70: [4, 258, 4, 1190], S76: [4, 293, 4, 1312], S92: [4, 258, 4, 1312], A109: [4, 385, 2, 2085], A119: [4, 395, 2, 2085], A139: [5, 300, 4, 1365],
    A169: [5, 330, 4, 1500], B06: [2, 394, 2, 2550], B407: [4, 413, 2, 2500], B412: [4, 324, 2, 1660], B429: [4, 395, 2, 2300], B505: [2, 400, 2, 2500], B212: [2, 324, 2, 1660], UH1: [2, 324, 2, 1660],
    R22: [2, 510, 2, 2850], R44: [2, 408, 2, 2500], R66: [2, 408, 2, 2500], H500: [5, 477, 2, 3000], MD52: [5, 492, 0, 0], MD60: [5, 395, 0, 0], EXPL: [5, 392, 0, 0], AS32: [4, 265, 5, 1280], EC25: [5, 265, 5, 1280],
    CH47: [3, 225, 3, 225], S61: [5, 203, 5, 1244], S64: [6, 185, 4, 1000], BK17: [4, 383, 2, 2169], EH10: [5, 213, 4, 1000]
  };
  const NAMES = {
    DH8D: 'Dash 8 Q400', DH8C: 'Dash 8-300', DH8A: 'Dash 8-100', AT76: 'ATR 72', AT75: 'ATR 72', AT72: 'ATR 72', AT45: 'ATR 42', AT46: 'ATR 42', C172: 'Cessna 172', C152: 'Cessna 152', C150: 'Cessna 150',
    C182: 'Cessna 182', C206: 'Cessna 206', C208: 'Cessna Caravan', P28A: 'Piper Cherokee', P28R: 'Piper Arrow', PA34: 'Piper Seneca', PA44: 'Piper Seminole', PA31: 'Piper Navajo', SR20: 'Cirrus SR20', SR22: 'Cirrus SR22',
    S22T: 'Cirrus SR22T', DA40: 'Diamond DA40', DA42: 'Diamond DA42', DA62: 'Diamond DA62', DV20: 'Diamond Katana', DA20: 'Diamond DA20', BE20: 'King Air 200', B350: 'King Air 350', BE58: 'Beech Baron', BE36: 'Beech Bonanza',
    PC12: 'Pilatus PC-12', TBM9: 'TBM 900', TBM8: 'TBM 850', TBM7: 'TBM 700', P06T: 'Tecnam P2006T', DHC6: 'Twin Otter', AS50: 'AS350 helicopter', EC35: 'EC135 helicopter', EC30: 'EC130 helicopter', EC45: 'EC145 helicopter',
    B06: 'Bell 206', B407: 'Bell 407', B429: 'Bell 429', R44: 'Robinson R44', R22: 'Robinson R22', R66: 'Robinson R66', A139: 'AW139', S76: 'Sikorsky S-76', H60: 'Black Hawk',
    A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330neo', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000',
    A388: 'Airbus A380', BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300', B712: 'Boeing 717', B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9',
    B752: 'Boeing 757', B763: 'Boeing 767', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B77W: 'Boeing 777-300ER', B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', B744: 'Boeing 747-400', B748: 'Boeing 747-8',
    E170: 'Embraer 170', E175: 'Embraer 175', E75S: 'Embraer 175', E75L: 'Embraer 175', E190: 'Embraer 190', E195: 'Embraer 195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2', CRJ1: 'CRJ100', CRJ2: 'CRJ200', CRJ7: 'CRJ700', CRJ9: 'CRJ900', CRJX: 'CRJ1000',
    C25A: 'Citation CJ2', C25B: 'Citation CJ3', C25C: 'Citation CJ4', C510: 'Citation Mustang', C525: 'Citation CJ', C550: 'Citation II', C560: 'Citation V', C56X: 'Citation Excel', C680: 'Citation Sovereign', C68A: 'Citation Latitude', C700: 'Citation Longitude', C750: 'Citation X',
    CL30: 'Challenger 300', CL35: 'Challenger 350', CL60: 'Challenger 600', GL5T: 'Global 5000', GLEX: 'Global Express', GL7T: 'Global 7500', GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', GA6C: 'Gulfstream G600', G280: 'Gulfstream G280',
    LJ35: 'Learjet 35', LJ45: 'Learjet 45', LJ60: 'Learjet 60', LJ75: 'Learjet 75', F2TH: 'Falcon 2000', FA7X: 'Falcon 7X', FA8X: 'Falcon 8X', FA50: 'Falcon 50', F900: 'Falcon 900', H25B: 'Hawker 800', HA4T: 'Hawker 4000', PC24: 'Pilatus PC-24', E55P: 'Phenom 300', E50P: 'Phenom 100', E545: 'Praetor 500', E550: 'Praetor 600', MD11: 'MD-11', MD82: 'MD-82', MD88: 'MD-88'
  };

  // What kind of sound an aircraft makes, from its ICAO type code and ADS-B emitter category.
  function classify(ac) {
    const t = (ac.t || '').toUpperCase(), cat = ac.cat || '';
    if (HELIS[t] || cat === 'A7') return { cls: 'heli', spec: HELIS[t] || [2, 400, 2, 2500], level: 0.7 };
    if (PROPS[t]) return { cls: 'prop', spec: PROPS[t], level: PROPS[t][4] };
    if (cat === 'A1') return { cls: 'prop', spec: [2, 2500, 2350, 1, 0.3], level: 0.3 };      // a light aircraft is almost always a piston single
    if (/^(C|B)/.test(cat)) return null;                                                           // ground vehicles, gliders, balloons, drones
    if (!t && !/^A[2-6]/.test(cat)) return { cls: 'prop', spec: [2, 2500, 2350, 1, 0.25], level: 0.25 };  // an unknown small target is usually a piston single
    const level = cat === 'A5' ? 0.95 : cat === 'A3' ? 0.7 : cat === 'A2' ? 0.5 : 0.55;
    return { cls: 'jet', spec: null, level };
  }
  function typeName(ac) {
    const t = (ac.t || '').toUpperCase();
    if (NAMES[t]) return NAMES[t];
    if (ac.desc) return ac.desc.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return t || (ac.cat === 'A1' ? 'light aircraft' : 'aircraft');
  }

  // ---------- tracks ----------
  // A track is [t_s, lat, lon, alt_m, gs_mps, track_deg, vs_mps][] sorted by time, on the feed's clock.
  function fillVelocities(s) {
    for (let i = 0; i < s.length; i++) {
      if (s[i][4] != null && s[i][5] != null) continue;
      const a = s[i > 0 ? i - 1 : i], b = s[i < s.length - 1 ? i + 1 : i];
      const dt = b[0] - a[0];
      if (dt < 0.5) { if (s[i][4] == null) s[i][4] = 0; if (s[i][5] == null) s[i][5] = 0; continue; }
      const kx = 111320 * Math.cos(a[1] * D2R), vx = (b[2] - a[2]) * kx / dt, vy = (b[1] - a[1]) * 110540 / dt;
      if (s[i][4] == null) s[i][4] = Math.hypot(vx, vy);
      if (s[i][5] == null) s[i][5] = (Math.atan2(vx, vy) / D2R + 360) % 360;
      if (s[i][6] == null) s[i][6] = (b[3] - a[3]) / dt;
    }
    for (const x of s) if (x[6] == null) x[6] = 0;
  }
  function velOf(x) {
    const tr = x[5] * D2R, gs = x[4];
    return { vx: gs * Math.sin(tr), vy: gs * Math.cos(tr), vz: x[6] };
  }
  // State (lat, lon, alt, velocity) at time t: interpolated inside the track, dead-reckoned a little beyond it.
  function stateAt(s, t) {
    const n = s.length;
    if (!n) return null;
    let i;
    if (t <= s[0][0]) i = -1;
    else if (t >= s[n - 1][0]) i = n - 1;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][0] <= t) lo = m; else hi = m; }
      i = lo;
    }
    if (i === -1 || i === n - 1) {
      const a = i === -1 ? s[0] : s[n - 1], dt = t - a[0];
      if (Math.abs(dt) > EXTRAP_S) return null;
      const v = velOf(a);
      return { lat: a[1] + v.vy * dt / 110540, lon: a[2] + v.vx * dt / (111320 * Math.cos(a[1] * D2R)), alt: a[3] + v.vz * dt, vx: v.vx, vy: v.vy, vz: v.vz, extrap: Math.abs(dt) };
    }
    const a = s[i], b = s[i + 1], u = (t - a[0]) / Math.max(1e-3, b[0] - a[0]);
    const va = velOf(a), vb = velOf(b);
    return { lat: a[1] + (b[1] - a[1]) * u, lon: a[2] + (b[2] - a[2]) * u, alt: a[3] + (b[3] - a[3]) * u, vx: va.vx + (vb.vx - va.vx) * u, vy: va.vy + (vb.vy - va.vy) * u, vz: va.vz + (vb.vz - va.vz) * u, extrap: 0 };
  }
  function enu(p, L) {
    return { x: (p.lon - L.lon) * 111320 * Math.cos(L.lat * D2R), y: (p.lat - L.lat) * 110540, z: p.alt - L.alt };
  }
  // What reaches the listener at time t: solve t = tau + d(tau)/c for the emission time tau.
  function heard(s, t, L) {
    let tau = t, st = null, e = null, d = 0;
    for (let k = 0; k < 8; k++) {
      st = stateAt(s, tau);
      if (!st) return null;
      e = enu(st, L); d = Math.hypot(e.x, e.y, e.z);
      const next = t - d / C;
      if (Math.abs(next - tau) < 0.02) { tau = next; break; }
      tau = next;
    }
    st = stateAt(s, tau);
    if (!st) return null;
    e = enu(st, L); d = Math.max(1, Math.hypot(e.x, e.y, e.z));
    const vr = (e.x * st.vx + e.y * st.vy + e.z * st.vz) / d;
    return { tau, d, vr, az: Math.atan2(e.x, e.y), el: Math.asin(clamp(e.z / d, -1, 1)), extrap: st.extrap, delay: t - tau, vz: st.vz, gs: Math.hypot(st.vx, st.vy) };
  }
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dirOf = (az) => DIRS[Math.round((((az / D2R) % 360) + 360) % 360 / 45) % 8];

  // ---------- voices ----------
  const waves = new Map();
  function wave(ctx, kind) {
    const key = kind + ctx.sampleRate;
    if (waves.has(key)) return waves.get(key);
    let n, amp;
    if (kind === 'prop') { n = 14; amp = (k) => Math.pow(k, -0.9); }
    else if (kind === 'rotor') { n = 48; amp = (k) => Math.pow(k, -0.5); }
    else { n = 8; amp = (k) => 1 / k; }
    const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) im[k] = amp(k);
    const w = ctx.createPeriodicWave(re, im);
    waves.set(key, w);
    return w;
  }
  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const sr = ctx.sampleRate, len = sr * 4, buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let y1 = 0, y2 = 0, peak = 0;
      const k = Math.exp(-2 * Math.PI * 700 / sr);
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; y1 = k * y1 + (1 - k) * w; y2 = k * y2 + (1 - k) * y1; d[i] = y2; if (Math.abs(y2) > peak) peak = Math.abs(y2); }
      for (let i = 0; i < len; i++) d[i] /= peak;
      // seamless loop: cross-fade the last 0.2 s into the first
      const xf = Math.floor(sr * 0.2);
      for (let i = 0; i < xf; i++) { const u = i / xf; d[len - xf + i] = d[len - xf + i] * (1 - u) + d[i] * u; }
    }
    noiseBuf = buf;
    return buf;
  }
  function makeVoice(ctx, info, out) {
    const v = { cls: info.cls, spec: info.spec, level: info.level, nodes: [] };
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 400; v.lp.Q.value = 0.4;
    v.gain = ctx.createGain(); v.gain.gain.value = 0;
    v.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    v.lp.connect(v.gain); v.gain.connect(v.pan); v.pan.connect(out);
    v.detune = 0.0008 + Math.random() * 0.002;  // twin engines never quite agree, so they beat, slowly: nulls every 4 to 15 s at 85 Hz
    if (info.cls === 'jet') {
      v.src = ctx.createBufferSource(); v.src.buffer = noise(ctx); v.src.loop = true;
      v.src.connect(v.lp); v.src.start();
      v.nodes.push(v.src);
    } else if (info.cls === 'heli') {
      v.osc = [ctx.createOscillator(), ctx.createOscillator()];
      v.osc[0].setPeriodicWave(wave(ctx, 'rotor')); v.osc[1].setPeriodicWave(wave(ctx, 'saw'));
      const tg = ctx.createGain(); tg.gain.value = info.spec[2] ? 0.35 : 0;
      v.osc[0].connect(v.lp); v.osc[1].connect(tg); tg.connect(v.lp);
      v.osc.forEach((o) => o.start());
      v.nodes.push(...v.osc);
    } else {
      const twin = info.spec[3] >= 2;
      v.osc = [ctx.createOscillator()];
      if (twin) v.osc.push(ctx.createOscillator());
      v.osc.forEach((o, i) => { o.setPeriodicWave(wave(ctx, 'prop')); const g = ctx.createGain(); g.gain.value = twin ? 0.6 : 1; o.connect(g); g.connect(v.lp); o.start(); });
      v.nodes.push(...v.osc);
    }
    return v;
  }
  function f0Of(v, h) {
    if (v.cls === 'heli') return v.spec[0] * v.spec[1] / 60;
    const climb = clamp(h.vz / 6, 0, 1);                 // 6 m/s (1200 ft/min) = full power
    const rpm = v.spec[2] + (v.spec[1] - v.spec[2]) * climb;
    return v.spec[0] * rpm / 60;
  }
  function updateVoice(v, h, walls, t, tau) {
    const dop = C / (C + h.vr);
    const horizon = clamp((h.el / D2R + 1) / 4, 0.25, 1);           // low on the horizon: ground and buildings in the way
    let amp = v.level * Math.min(1, 300 / h.d) * horizon;
    let lp = clamp(10000 * Math.exp(-h.d / 2000), 120, 10000);       // the air absorbs the highs with distance
    if (walls) { lp = Math.min(lp, 300); amp *= 0.6; }
    if (h.extrap > EXTRAP_S - 8) amp *= (EXTRAP_S - h.extrap) / 8;   // lost from the feed: let go gently
    if (v.cls === 'jet') {
      v.src.playbackRate.setTargetAtTime(dop, t, tau);
    } else if (v.cls === 'heli') {
      const f = f0Of(v, h) * dop;
      v.osc[0].frequency.setTargetAtTime(f, t, tau);
      v.osc[1].frequency.setTargetAtTime((v.spec[2] ? v.spec[2] * v.spec[3] / 60 : 70) * dop, t, tau);
      v.f = f;
    } else {
      const f = f0Of(v, h) * dop;
      v.osc.forEach((o, i) => o.frequency.setTargetAtTime(f * (i ? 1 + v.detune : 1), t, tau));
      v.f = f;
    }
    v.lp.frequency.setTargetAtTime(lp, t, tau);
    v.gain.gain.setTargetAtTime(amp, t, tau);
    if (v.pan.pan) v.pan.pan.setTargetAtTime(clamp(Math.sin(h.az) * 0.8, -0.8, 0.8), t, tau * 3);
    v.amp = amp; v.dop = dop;
  }
  function stopVoice(v, t) {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => { v.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } }); try { v.pan.disconnect(); } catch (e) { /* fine */ } }, 2500);
  }

  // ---------- the engine ----------
  const CSS = `
.oh{display:grid;gap:12px;font-size:14px}
.oh-top{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.oh-btn{font:inherit;font-weight:600;font-size:15px;color:var(--oh-fg);background:transparent;border:1px solid var(--oh-acc);border-radius:10px;padding:10px 16px;min-height:44px;cursor:pointer}
.oh-btn:hover{box-shadow:0 0 0 3px color-mix(in srgb,var(--oh-acc) 22%,transparent)}
.oh-btn.on{background:color-mix(in srgb,var(--oh-acc) 14%,transparent)}
.oh-btn:disabled{opacity:.6;cursor:progress}
.oh-status{color:var(--oh-muted);font-size:13px;display:flex;align-items:center;gap:7px;min-width:0}
.oh-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--oh-faint);flex:none}
.oh-status.live .oh-dot{background:var(--oh-acc);box-shadow:0 0 8px var(--oh-acc)}
.oh-spec{display:block;width:100%;height:170px;border:1px solid var(--oh-line);border-radius:10px;background:var(--oh-panel)}
.oh-list{list-style:none;margin:0;padding:0;display:grid;gap:6px;font:12.5px/1.45 var(--oh-mono);color:var(--oh-muted)}
.oh-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:baseline}
.oh-list b{color:var(--oh-fg);font-weight:600}
.oh-list .oh-hz{color:var(--oh-acc2);white-space:nowrap}
.oh-list .oh-empty{color:var(--oh-faint)}
.oh-ctl{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;color:var(--oh-muted);font-size:13px}
.oh-ctl label{display:flex;align-items:center;gap:8px}
.oh-ctl input[type=range]{width:120px;accent-color:var(--oh-acc);margin:0}
.oh-ctl input[type=checkbox]{accent-color:var(--oh-acc);margin:0}
.oh-link{font:inherit;color:var(--oh-acc);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.oh-foot{color:var(--oh-faint);font-size:12.5px;margin:0}
@media (max-width:560px){.oh-spec{height:140px}}
`;

  function mount(container, opts) {
    opts = opts || {};
    const theme = Object.assign({ fg: '#e9ecf3', muted: '#939cb0', faint: '#5f687c', line: '#1a2232', panel: '#080c14', acc: '#8fe3ff', acc2: '#ffd27f', mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' }, opts.theme || {});
    if (!document.getElementById('oh-css')) { const st = document.createElement('style'); st.id = 'oh-css'; st.textContent = CSS; document.head.appendChild(st); }
    const root = document.createElement('div'); root.className = 'oh';
    for (const k of Object.keys(theme)) root.style.setProperty('--oh-' + k, theme[k]);
    root.innerHTML = '<div class="oh-top"><button class="oh-btn" type="button">Listen to the sky</button><div class="oh-status"><span class="oh-dot"></span><span class="oh-text">Reading the sky over Toronto...</span></div></div>'
      + '<canvas class="oh-spec" role="img" aria-label="Spectrogram of the aircraft you are hearing: time runs left to right, pitch from 0 to 500 Hz bottom to top. Each plane draws a falling curve as it passes."></canvas>'
      + '<ul class="oh-list"><li><span class="oh-empty">Press the button. Each aircraft within earshot will be listed here as it is heard.</span></li></ul>'
      + '<div class="oh-ctl"><label>Volume <input class="oh-vol" type="range" min="0" max="1" step="0.01" value="0.6"></label>'
      + '<label><input class="oh-walls" type="checkbox"> Through walls</label>'
      + '<span class="oh-where">Listening from downtown Toronto. <button class="oh-link oh-gps" type="button">Use my location</button></span></div>'
      + '<p class="oh-foot">Aircraft positions are public ADS-B transponder data, relayed by this site a few seconds late. The engine sounds are made here; the aircraft, their tracks and the Doppler shift are real. Nothing is recorded, and your location never leaves this page.</p>';
    container.replaceChildren(root);
    const el = {
      btn: root.querySelector('.oh-btn'), status: root.querySelector('.oh-status'), text: root.querySelector('.oh-text'), spec: root.querySelector('.oh-spec'),
      list: root.querySelector('.oh-list'), vol: root.querySelector('.oh-vol'), walls: root.querySelector('.oh-walls'), where: root.querySelector('.oh-where'), gps: root.querySelector('.oh-gps')
    };

    const feedURL = (() => {
      try { const q = new URLSearchParams(location.search).get('overhead'); if (q) return q; } catch (e) { /* fine */ }
      if (opts.feed) return opts.feed;
      return (/(^|\.)ronishbhatt\.com$/.test(location.hostname) ? '' : 'https://ronishbhatt.com') + '/overhead/now.json';
    })();
    const name = opts.name || document.title || 'this page';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
    if (saved.vol != null) el.vol.value = saved.vol;
    if (saved.walls) el.walls.checked = true;
    const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ vol: el.vol.value, walls: el.walls.checked })); } catch (e) { /* private mode */ } };

    const S = {
      ctx: null, playing: false, voices: new Map(), tracks: new Map(), feed: null, feedAt: 0, skew: null, fails: 0,
      listener: Object.assign({}, DEFAULT_LISTENER), pinned: false, center: DEFAULT_LISTENER, radius: 55.6, yield: null, since: 0, id: Math.random().toString(36).slice(2),
      timers: {}
    };

    // ---- audio graph: tonal voices -> sum -> analyser (the spectrogram) and compressor; jets -> compressor; -> volume -> out
    // Jets are broadband and would paint the whole spectrogram white; the curves worth seeing are the blade-pass tones.
    function ensureAudio() {
      if (S.ctx) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'playback' });
      S.ctx = ctx;
      S.sum = ctx.createGain(); S.sum.gain.value = 1;
      S.noisy = ctx.createGain(); S.noisy.gain.value = 1;
      S.analyser = ctx.createAnalyser();
      try { S.analyser.fftSize = 32768; } catch (e) { S.analyser.fftSize = 2048; }   // 1.3 Hz bins at 44.1 kHz: enough to draw a 100 Hz curve
      S.analyser.smoothingTimeConstant = 0;
      S.analyser.minDecibels = -95; S.analyser.maxDecibels = -15;
      S.comp = ctx.createDynamicsCompressor(); S.comp.threshold.value = -18; S.comp.knee.value = 12; S.comp.ratio.value = 6; S.comp.attack.value = 0.01; S.comp.release.value = 0.5;
      S.vol = ctx.createGain(); S.vol.gain.value = 0;
      S.sum.connect(S.analyser); S.sum.connect(S.comp); S.noisy.connect(S.comp); S.comp.connect(S.vol); S.vol.connect(ctx.destination);
      S.bins = new Uint8Array(S.analyser.frequencyBinCount);
    }
    const volGain = () => 2.2 * Math.pow(+el.vol.value, 1.6) * (S.yield ? 0 : 1);
    function applyVol() { if (!S.ctx) return; S.vol.gain.setTargetAtTime(S.playing ? volGain() : 0, S.ctx.currentTime, 0.2); }

    // ---- the feed
    async function poll() {
      if (S.timers.poll) clearTimeout(S.timers.poll);
      const wait = document.hidden ? POLL_MS * 2 : POLL_MS;
      try {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
        const t0 = Date.now();
        const r = await fetch(feedURL, { cache: 'no-store', signal: ac.signal });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const t1 = Date.now();
        if (!j || !Array.isArray(j.aircraft)) throw new Error('bad feed');
        const sk = t1 - j.generated;                                    // our clock minus the feed's, inflated by the file's age
        S.skew = S.skew == null ? sk : Math.min(sk, S.skew + 80);
        S.feed = j; S.feedAt = t1; S.fails = 0;
        if (Array.isArray(j.center)) S.center = { lat: j.center[0], lon: j.center[1] };
        if (j.radius_km) S.radius = j.radius_km;
        ingest(j);
      } catch (e) {
        S.fails++;
      }
      status();
      S.timers.poll = setTimeout(poll, wait);
    }
    function ingest(j) {
      const seen = new Set();
      for (const a of j.aircraft) {
        if (!a.hex || !Array.isArray(a.trail) || !a.trail.length) continue;
        seen.add(a.hex);
        let tr = S.tracks.get(a.hex);
        if (!tr) { tr = { ac: a, info: classify(a), name: typeName(a) }; S.tracks.set(a.hex, tr); }
        else { tr.ac = a; if (!tr.info || !a.t) { tr.info = classify(a); tr.name = typeName(a); } }
        const s = a.trail.map((x) => [x[0] / 1000, x[1], x[2], x[3], x[4], x[5], x[6]]);
        fillVelocities(s);
        tr.s = s; tr.lastFeed = Date.now();
      }
      for (const [hex, tr] of S.tracks) if (!seen.has(hex) && Date.now() - tr.lastFeed > 60000) { S.tracks.delete(hex); dropVoice(hex); }
    }
    const feedNow = () => (Date.now() - (S.skew || 0)) / 1000;

    // ---- the listener
    function inside(p) { return !!p && isFinite(p.lat) && isFinite(p.lon) && Math.hypot((p.lon - S.center.lon) * 111.32 * Math.cos(S.center.lat * D2R), (p.lat - S.center.lat) * 110.54) < S.radius - 8; }
    function setListener(p, how) {
      S.listener = { lat: p.lat, lon: p.lon, alt: p.alt != null ? p.alt : DEFAULT_LISTENER.alt, name: p.name || 'here' };
      el.where.firstChild.textContent = 'Listening from ' + S.listener.name + (how ? ', ' + how : '') + '. ';
    }
    function considerHost() {
      if (S.pinned || !opts.listener) return;
      let p = null;
      try { p = opts.listener(); } catch (e) { p = null; }
      if (p && inside(p)) { if (Math.abs(p.lat - S.listener.lat) > 1e-4 || Math.abs(p.lon - S.listener.lon) > 1e-4 || S.listener.name !== (p.name || 'here')) setListener(p, opts.how || ''); }
      else if (S.listener.name !== DEFAULT_LISTENER.name) setListener(DEFAULT_LISTENER);
    }
    el.gps.addEventListener('click', () => {
      if (!navigator.geolocation) { el.text.textContent = 'This browser cannot share a location.'; return; }
      el.gps.disabled = true; el.gps.textContent = 'Asking...';
      navigator.geolocation.getCurrentPosition((pos) => {
        el.gps.disabled = false; el.gps.textContent = 'Use my location';
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'your location' };
        if (inside(p)) { S.pinned = true; setListener(p); }
        else { el.text.textContent = 'You are outside the circle the feed covers (' + Math.round(S.radius) + ' km around downtown Toronto), so it keeps listening from downtown.'; }
      }, () => { el.gps.disabled = false; el.gps.textContent = 'Use my location'; el.text.textContent = 'No location shared, so it listens from downtown Toronto.'; }, { timeout: 15000, maximumAge: 600000 });
    });

    // ---- voices follow the feed
    function dropVoice(hex) {
      const v = S.voices.get(hex);
      if (!v) return;
      S.voices.delete(hex);
      if (S.ctx) stopVoice(v, S.ctx.currentTime);
    }
    function tick() {
      if (!S.playing || !S.ctx) return;
      const t = S.ctx.currentTime, now = feedNow(), L = S.listener, walls = el.walls.checked;
      const live = [];
      for (const [hex, tr] of S.tracks) {
        if (!tr.info || !tr.s) { continue; }
        const h = heard(tr.s, now, L);
        if (!h || h.d > EARSHOT) { dropVoice(hex); continue; }
        let v = S.voices.get(hex);
        if (!v) { v = makeVoice(S.ctx, tr.info, tr.info.cls === 'jet' ? S.noisy : S.sum); v.hex = hex; S.voices.set(hex, v); }
        updateVoice(v, h, walls, t, 0.12);
        live.push({ hex, tr, v, h });
      }
      S.live = live;
    }

    // ---- words and pictures
    function status() {
      const age = S.feed ? (Date.now() - S.feedAt) / 1000 : null;
      const ok = S.feed && S.fails < 3;
      el.status.classList.toggle('live', !!ok);
      if (!S.feed) { el.text.textContent = S.fails ? 'The sky feed is not answering. It will keep trying.' : 'Reading the sky over Toronto...'; return; }
      const n = S.tracks.size, heardN = S.live ? S.live.length : 0;
      let s = n + ' aircraft over the GTA' + (S.playing ? ', ' + heardN + ' within earshot' : '');
      if (S.feed.error) s += '. Feed stale: ' + S.feed.error.split(':')[0];
      else if (age > 20) s += '. Feed ' + Math.round(age) + ' s old';
      if (S.yield) s += '. Playing in your other tab (' + S.yield.name + '); stop it there to hear it here';
      el.text.textContent = s + '.';
    }
    function fmtKm(m) { return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 9500 ? 1 : 0) + ' km'; }
    function renderList() {
      if (!S.playing) return;
      const live = (S.live || []).slice().sort((a, b) => b.v.amp - a.v.amp);
      if (!live.length) { el.list.innerHTML = '<li><span class="oh-empty">' + (S.tracks.size ? 'Nothing within ' + (EARSHOT / 1000) + ' km of ' + S.listener.name + ' right now. The sky is quiet; it will not stay that way.' : 'Waiting for the feed.') + '</span></li>'; return; }
      el.list.replaceChildren(...live.slice(0, 8).map(({ tr, v, h }) => {
        const li = document.createElement('li');
        const a = tr.ac, label = a.flight || a.r || a.hex.toUpperCase();
        const phase = h.vz > 2.5 ? 'climbing' : h.vz < -2.5 ? 'descending' : 'level';
        const left = document.createElement('span');
        const b = document.createElement('b'); b.textContent = label;
        left.append(b, document.createTextNode(' ' + tr.name + ', ' + fmtKm(h.d) + ' to the ' + dirOf(h.az) + ', ' + phase + ', heard ' + Math.round(h.delay) + ' s after the fact' + (h.vr < -3 ? ', coming' : h.vr > 3 ? ', going' : ', abeam')));
        const hz = document.createElement('span'); hz.className = 'oh-hz';
        hz.textContent = v.cls === 'jet' ? (v.dop > 1.01 ? '+' : v.dop < 0.99 ? '-' : '') + Math.abs(Math.round((v.dop - 1) * 100)) + '% pitch' : Math.round(v.f) + ' Hz';
        li.append(left, hz);
        return li;
      }));
    }
    // spectrogram: one column every 250 ms, 0-500 Hz bottom to top, from the sound actually being played
    const spec = { cv: el.spec, buf: document.createElement('canvas'), last: 0, w: 0, h: 0, dpr: 1 };
    function sizeSpec() {
      const w = spec.cv.clientWidth || 300, h = spec.cv.clientHeight || 170, dpr = Math.min(2, global.devicePixelRatio || 1);
      if (spec.w === w && spec.h === h && spec.dpr === dpr) return;
      const old = spec.buf;
      spec.w = w; spec.h = h; spec.dpr = dpr;
      spec.cv.width = Math.round(w * dpr); spec.cv.height = Math.round(h * dpr);
      const nb = document.createElement('canvas'); nb.width = spec.cv.width; nb.height = spec.cv.height;
      if (old.width) nb.getContext('2d').drawImage(old, nb.width - old.width, 0);
      spec.buf = nb;
    }
    function hexRGB(c) { const m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return [143, 227, 255]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const ACC = hexRGB(theme.acc), ACC2 = hexRGB(theme.acc2);
    function drawSpec(ts) {
      if (ts - spec.last < 250) return;
      spec.last = ts;
      sizeSpec();
      const W = spec.buf.width, H = spec.buf.height, b = spec.buf.getContext('2d');
      b.drawImage(spec.buf, -1, 0);
      b.clearRect(W - 1, 0, 1, H);
      if (S.playing && S.ctx && S.ctx.state === 'running') {
        S.analyser.getByteFrequencyData(S.bins);
        const binHz = S.ctx.sampleRate / S.analyser.fftSize;
        const col = b.createImageData(1, H), d = col.data;
        for (let y = 0; y < H; y++) {
          const f = 500 * (1 - y / H), i0 = Math.floor(f / binHz), i1 = Math.max(i0, Math.floor((f + 500 / H) / binHz));
          let m = 0; for (let i = i0; i <= i1; i++) if (S.bins[i] > m) m = S.bins[i];
          const a = Math.pow(m / 255, 1.3);
          d[y * 4] = ACC[0]; d[y * 4 + 1] = ACC[1]; d[y * 4 + 2] = ACC[2]; d[y * 4 + 3] = Math.round(255 * a);
        }
        b.putImageData(col, W - 1, 0);
      }
      const c = spec.cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      c.drawImage(spec.buf, 0, 0);
      c.setTransform(spec.dpr, 0, 0, spec.dpr, 0, 0);
      c.font = '10px ' + theme.mono; c.textBaseline = 'bottom'; c.textAlign = 'left';
      for (const hz of [100, 200, 300, 400]) {
        const y = spec.h * (1 - hz / 500);
        c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(spec.w, Math.round(y) + 0.5); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillText(hz + ' Hz', 6, y - 2);
      }
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.textAlign = 'right';
      c.fillText((spec.buf.width * 0.25 / 60).toFixed(1) + ' min across', spec.w - 6, spec.h - 4);
      c.fillText('now', spec.w - 6, 12);
      c.textAlign = 'left'; c.fillText('then', 6, 12);
      // the modelled fundamental of each voice, at the right edge
      for (const x of S.live || []) {
        if (x.v.cls === 'jet' || !x.v.f) continue;
        const y = spec.h * (1 - x.v.f / 500);
        if (y < 0 || y > spec.h) continue;
        c.fillStyle = 'rgba(' + ACC2.join(',') + ',' + clamp(0.25 + x.v.amp * 6, 0.25, 1).toFixed(2) + ')';
        c.fillRect(spec.w - 4, y - 1, 4, 2);
      }
      if (!S.playing) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.textAlign = 'center'; c.font = '12px ' + theme.mono; c.fillText('the Doppler curves will draw here', spec.w / 2, spec.h / 2 + 4); }
    }
    function frame(ts) { requestAnimationFrame(frame); drawSpec(ts); }

    // ---- one sky per browser: two open pages agree on who plays it
    let bc = null;
    try { bc = 'BroadcastChannel' in global ? new BroadcastChannel('ronishbhatt-overhead') : null; } catch (e) { bc = null; }
    function beat() { if (bc && S.playing) bc.postMessage({ id: S.id, since: S.since, name }); }
    if (bc) bc.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.id === S.id) return;
      if (m.stop) { if (S.yield && S.yield.id === m.id) { S.yield = null; applyVol(); status(); } return; }
      if (!S.playing) return;
      if (m.since < S.since || (m.since === S.since && m.id < S.id)) { const was = S.yield; S.yield = { id: m.id, name: m.name, at: Date.now() }; if (!was) { applyVol(); status(); } }
      else beat();
    };
    function checkYield() { if (S.yield && Date.now() - S.yield.at > 6500) { S.yield = null; applyVol(); status(); } }

    // ---- start, stop
    async function start() {
      try { ensureAudio(); } catch (e) { el.text.textContent = 'This browser has no Web Audio, so there is nothing to hear.'; return; }
      el.btn.disabled = true;
      try { await S.ctx.resume(); } catch (e) { /* resumes on the next gesture */ }
      el.btn.disabled = false;
      S.playing = true; S.since = Date.now(); S.yield = null;
      applyVol(); beat();
      el.btn.textContent = 'Stop'; el.btn.classList.add('on');
      if (!S.timers.tick) S.timers.tick = setInterval(tick, TICK_MS);
      if (!S.timers.list) S.timers.list = setInterval(() => { renderList(); status(); checkYield(); }, 1000);
      if (!S.timers.beat) S.timers.beat = setInterval(beat, 2000);
      tick(); renderList(); status();
    }
    function stop() {
      S.playing = false;
      if (S.ctx) { const t = S.ctx.currentTime; S.vol.gain.cancelScheduledValues(t); S.vol.gain.setTargetAtTime(0, t, 0.3); }
      for (const hex of [...S.voices.keys()]) dropVoice(hex);
      if (bc) bc.postMessage({ id: S.id, stop: true });
      ['tick', 'list', 'beat'].forEach((k) => { if (S.timers[k]) { clearInterval(S.timers[k]); S.timers[k] = 0; } });
      el.btn.textContent = 'Listen to the sky'; el.btn.classList.remove('on');
      el.list.innerHTML = '<li><span class="oh-empty">Stopped. The sky goes on without you.</span></li>';
      status();
      setTimeout(() => { if (!S.playing && S.ctx && S.ctx.state === 'running') S.ctx.suspend(); }, 2000);
    }
    el.btn.addEventListener('click', () => { if (S.playing) stop(); else start(); });
    el.vol.addEventListener('input', () => { applyVol(); });
    el.vol.addEventListener('change', save);
    el.walls.addEventListener('change', save);
    global.addEventListener('pagehide', () => { if (bc && S.playing) bc.postMessage({ id: S.id, stop: true }); });

    poll();
    considerHost();
    setInterval(considerHost, 2000);
    requestAnimationFrame(frame);

    return {
      start, stop, setListener: (p) => { S.pinned = true; if (inside(p)) setListener(p); },
      get playing() { return S.playing; }, get aircraft() { return S.live || []; }, get feed() { return S.feed; }, heard, stateAt, classify
    };
  }

  global.Overhead = { mount, heard, stateAt, classify, PROPS, HELIS };
})(window);
