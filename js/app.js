/* js/app.js – Kandong v1.2.1 vanilla PWA */
(function () {
  'use strict';

  const cfg = window.KANDONG_CONFIG;
  const $ = (sel, el = document) => el.querySelector(sel);
  const PLACES = cfg.PLACES || [];

  const state = {
    mode: 'passenger',
    status: 'idle',
    name: 'Juan',
    pickup: '',
    drop: '',
    online: false,
    riderName: 'Rider Edwin',
    progress: 0,
    nav: 'Home',
    toast: null,
    toastTimer: null,
    showInstall: false,
    showSettings: false,
    showAbout: false,
    isInstalled: false,
    offline: !navigator.onLine,
    conn: 'disconnected',
    connError: null,
    client: null,
    currentBooking: null,
    liveBookings: [],
    bookingBusy: false,
    deferredPrompt: null,
    locLoading: false,
    coords: null,
    suggestField: null, // 'pickup' | 'drop' | null
    suggestions: [],
  };

  let pollTimer = null;
  let progressTimer = null;
  let suggestTimer = null;

  function toast(msg, ms = 3200) {
    state.toast = msg;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      state.toast = null;
      render();
    }, ms);
    render();
  }

  function calcFare() {
    const p = state.pickup.trim();
    const d = state.drop.trim();
    if (p.length < 3 || d.length < 3) return null;
    const extra = (p.length + d.length) % 45;
    return Math.min(cfg.FARE_MAX, cfg.FARE_BASE + extra);
  }

  function hasKey() {
    const k = localStorage.getItem('kandong_anon_key') || cfg.SUPABASE_ANON_KEY;
    return k && k !== 'PASTE_YOUR_ANON_KEY_HERE' && k.length > 20;
  }

  function filterPlaces(query) {
    const q = (query || '').trim().toLowerCase();
    if (q.length < 1) return PLACES.slice(0, 8);
    const scored = PLACES.map((p) => {
      const name = p.name.toLowerCase();
      const area = (p.area || '').toLowerCase();
      let score = 0;
      if (name.startsWith(q)) score += 100;
      else if (name.includes(q)) score += 50;
      if (area.includes(q)) score += 30;
      return { ...p, score };
    })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 8);
  }

  function openSuggest(field, value) {
    state.suggestField = field;
    state.suggestions = filterPlaces(value);
    render();
  }

  function pickSuggestion(place) {
    const label = place.area ? `${place.name}, ${place.area}` : place.name;
    if (state.suggestField === 'pickup') state.pickup = label;
    else if (state.suggestField === 'drop') state.drop = label;
    state.suggestField = null;
    state.suggestions = [];
    render();
  }

  function closeSuggest() {
    state.suggestField = null;
    state.suggestions = [];
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast('Geolocation hindi supported sa device mo');
      return;
    }
    state.locLoading = true;
    render();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        state.coords = { lat: latitude, lng: longitude };
        let label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`,
            { headers: { Accept: 'application/json' } }
          );
          if (res.ok) {
            const data = await res.json();
            const a = data.address || {};
            const parts = [
              a.road || a.pedestrian || a.neighbourhood,
              a.suburb || a.village || a.town || a.city_district,
              a.city || a.municipality || a.county,
            ].filter(Boolean);
            if (parts.length) label = parts.slice(0, 2).join(', ');
            else if (data.display_name) {
              label = data.display_name.split(',').slice(0, 2).join(',').trim();
            }
          }
        } catch (_) {
          /* keep coords as label */
        }
        state.pickup = label;
        state.locLoading = false;
        closeSuggest();
        toast('📍 Current location set as pickup');
        render();
      },
      (err) => {
        state.locLoading = false;
        const msg =
          err.code === 1
            ? 'Payagan ang location access sa browser'
            : err.code === 2
              ? 'Hindi makuha ang GPS signal'
              : 'Timeout – subukan ulit';
        toast(msg);
        render();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function connect() {
    if (!hasKey()) {
      state.client = null;
      state.conn = 'disconnected';
      state.connError = null;
      return;
    }
    state.conn = 'connecting';
    state.client = window.createKandongClient();
    if (!state.client) {
      state.conn = 'error';
      state.connError = 'Invalid key';
      render();
      return;
    }
    try {
      const { error } = await state.client.from('bookings').select('id').limit(1);
      if (error) {
        state.conn = 'error';
        state.connError = error.message;
      } else {
        state.conn = 'connected';
        state.connError = null;
        toast('Supabase connected ✓');
      }
    } catch (e) {
      state.conn = 'error';
      state.connError = e.message;
    }
    render();
  }

  async function createBooking() {
    const fare = calcFare();
    if (!fare || state.bookingBusy) return;
    if (!hasKey() || !state.client) {
      state.status = 'searching';
      state.progress = 0;
      toast('Supabase key missing • Local demo mode');
      startDemoProgress();
      render();
      return;
    }
    state.bookingBusy = true;
    render();
    try {
      const row = {
        passenger_name: state.name.trim() || 'Guest',
        pickup: state.pickup.trim(),
        drop_location: state.drop.trim(),
        fare,
        status: 'searching',
      };
      const { data, error } = await state.client.from('bookings').insert(row).select();
      if (error) throw new Error(error.message);
      const booking = Array.isArray(data) ? data[0] : data;
      state.currentBooking = booking;
      state.status = 'searching';
      state.progress = 0;
      toast(`Booking created • ₱${fare}`);
      startBookingPoll();
    } catch (e) {
      toast(`Booking failed: ${e.message}`);
      state.conn = 'error';
      state.connError = e.message;
    } finally {
      state.bookingBusy = false;
      render();
    }
  }

  async function fetchLiveBookings() {
    if (!state.client || !state.online) return;
    try {
      const { data, error } = await state.client
        .from('bookings')
        .select('*')
        .eq('status', 'searching')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && data) {
        state.liveBookings = data;
        render();
      }
    } catch (_) {}
  }

  async function updateBooking(id, patch) {
    if (!state.client) return;
    try {
      const { error } = await state.client.from('bookings').update(patch).eq('id', id);
      if (error) throw error;
      await fetchLiveBookings();
    } catch (e) {
      toast(`Update failed: ${e.message}`);
    }
  }

  function startBookingPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      if (!state.currentBooking?.id || !state.client) return;
      try {
        const { data } = await state.client
          .from('bookings')
          .select('*')
          .eq('id', state.currentBooking.id)
          .limit(1);
        const b = data?.[0];
        if (!b) return;
        state.currentBooking = b;
        if (b.status === 'assigned') state.status = 'assigned';
        else if (b.status === 'ontheway') {
          state.status = 'ontheway';
          if (state.progress < 10) state.progress = 10;
          startProgress();
        } else if (b.status === 'arrived') {
          state.status = 'arrived';
          state.progress = 100;
        } else if (b.status === 'completed' || b.status === 'cancelled') {
          cancelBooking(true);
        }
        render();
      } catch (_) {}
    }, cfg.POLL_INTERVAL_MS);
  }

  function startProgress() {
    stopProgress();
    progressTimer = setInterval(() => {
      if (state.progress >= 100) {
        state.status = 'arrived';
        stopProgress();
        render();
        return;
      }
      state.progress = Math.min(100, state.progress + 0.9);
      render();
    }, 100);
  }

  function startDemoProgress() {
    setTimeout(() => {
      state.status = 'assigned';
      render();
    }, 1800);
    setTimeout(() => {
      state.status = 'ontheway';
      state.progress = 10;
      startProgress();
      render();
    }, 3800);
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function stopProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  async function cancelBooking(silent) {
    if (state.currentBooking?.id && state.client && hasKey()) {
      try {
        await state.client
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('id', state.currentBooking.id);
      } catch (_) {}
    }
    state.status = 'idle';
    state.progress = 0;
    state.currentBooking = null;
    stopPoll();
    stopProgress();
    if (!silent) toast('Booking cancelled');
    render();
  }

  function setMode(m) {
    state.mode = m;
    closeSuggest();
    toast(m === 'passenger' ? 'PASAHERO mode' : 'RIDER mode');
    if (m === 'rider' && state.online) fetchLiveBookings();
    render();
  }

  function toggleOnline() {
    state.online = !state.online;
    toast(state.online ? 'Online ka na • Listening bookings' : 'Offline • Pahinga muna');
    if (state.online) {
      fetchLiveBookings();
      stopPoll();
      pollTimer = setInterval(fetchLiveBookings, cfg.POLL_INTERVAL_MS);
    } else {
      stopPoll();
    }
    render();
  }

  function acceptBooking(b) {
    updateBooking(b.id, { status: 'assigned', rider_name: state.riderName });
    toast(`Accepted • ${b.passenger_name}`);
  }
  function setOnTheWay(b) {
    updateBooking(b.id, { status: 'ontheway' });
    toast('On the way • Passenger notified');
  }
  function setArrived(b) {
    updateBooking(b.id, { status: 'arrived' });
    toast('Arrived • Completed');
  }

  function saveKey() {
    const input = $('#anon-key-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val || val.length < 20) {
      toast('Invalid anon key • Must be JWT');
      return;
    }
    localStorage.setItem('kandong_anon_key', val);
    state.showSettings = false;
    toast('Anon key saved • Connecting…');
    connect();
  }

  function clearKey() {
    localStorage.removeItem('kandong_anon_key');
    state.client = null;
    state.conn = 'disconnected';
    state.connError = null;
    toast('Anon key cleared');
    render();
  }

  function copySQL() {
    const sql = `create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  passenger_name text not null,
  pickup text not null,
  drop_location text not null,
  fare int not null,
  status text not null default 'searching',
  rider_name text
);
alter table public.bookings enable row level security;
drop policy if exists "Allow all for anon" on public.bookings;
create policy "Allow all for anon" on public.bookings for all using (true) with check (true);
alter publication supabase_realtime add table public.bookings;`;
    navigator.clipboard.writeText(sql).then(() => toast('SQL copied')).catch(() => toast('Copy failed'));
  }

  async function installApp() {
    if (state.deferredPrompt) {
      state.deferredPrompt.prompt();
      const { outcome } = await state.deferredPrompt.userChoice;
      if (outcome === 'accepted') toast('Salamat! Naka-install na ang Kandong 🛵');
      else toast('Install cancelled');
      state.deferredPrompt = null;
      state.showInstall = false;
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      toast(
        isIOS
          ? 'iPhone: Tap Share → Add to Home Screen'
          : 'Menu → Install app / Add to Home Screen'
      );
    }
    render();
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function suggestDropdown(field) {
    if (state.suggestField !== field || !state.suggestions.length) return '';
    return `
    <div class="suggest-box" role="listbox">
      ${state.suggestions
        .map(
          (p, i) => `
        <button type="button" class="suggest-item" data-suggest-idx="${i}" role="option">
          <span class="suggest-name">${esc(p.name)}</span>
          <span class="suggest-area">${esc(p.area || '')}</span>
        </button>`
        )
        .join('')}
    </div>`;
  }

  function render() {
    const root = $('#app');
    if (!root) return;

    const fare = calcFare();
    const canBook = fare !== null && !state.bookingBusy;

    root.innerHTML = `
<div class="phone">
  <div class="header">
    <div class="header-row">
      <div class="logo">
        <div class="logo-icon">K</div>
        <div>
          <div class="flex items-center gap-2">
            <h1>KANDONG</h1>
            <span class="badge">v${cfg.VERSION} • PWA</span>
          </div>
          <p class="logo-sub">HABAL • KANDONG</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn ${hasKey() ? 'active' : ''}" data-action="settings" aria-label="Settings">⚙️</button>
        <button class="icon-btn" data-action="about" aria-label="About">ℹ️</button>
      </div>
    </div>

    <div class="status-bar">
      <div class="status-pill ${state.conn === 'connected' ? 'connected' : state.conn === 'error' ? 'error' : 'warning'}">
        <span>${state.conn === 'connected' ? '🟢' : state.conn === 'error' ? '🔴' : '🟡'}</span>
        <span class="truncate">
          ${
            state.conn === 'connected'
              ? `Supabase Live • ${state.liveBookings.length} searching`
              : state.conn === 'error'
                ? `Error: ${(state.connError || '').slice(0, 50)}`
                : state.conn === 'connecting'
                  ? 'Connecting…'
                  : 'Anon key missing • Tap ⚙️'
          }
        </span>
      </div>

      ${
        state.showInstall && !state.isInstalled
          ? `
      <div class="install-banner">
        <div class="icon">K</div>
        <div style="flex:1;min-width:0">
          <p>I-install ang Kandong App</p>
          <p class="sub">Lalabas sa app drawer • Offline ready</p>
        </div>
        <button data-action="install">INSTALL</button>
        <button class="dismiss" data-action="dismiss-install">✕</button>
      </div>`
          : ''
      }
    </div>

    <div class="mode-toggle">
      <div class="mode-toggle-inner">
        <button class="mode-btn ${state.mode === 'passenger' ? 'active' : ''}" data-action="mode-passenger">👤 PASAHERO</button>
        <button class="mode-btn ${state.mode === 'rider' ? 'active' : ''}" data-action="mode-rider">🛵 RIDER</button>
      </div>
    </div>
  </div>

  <div class="content">
    ${state.mode === 'passenger' ? renderPassenger(fare, canBook) : renderRider()}
  </div>

  <div class="bottom-nav">
    ${['Home', 'Biyahe', 'Chat', 'Account']
      .map(
        (n) => `
      <button class="nav-item ${state.nav === n ? 'active' : ''}" data-nav="${n}">
        <div class="icon">${n === 'Home' ? '🏠' : n === 'Biyahe' ? '🧾' : n === 'Chat' ? '💬' : '👤'}</div>
        <span>${n}</span>
      </button>`
      )
      .join('')}
  </div>

  ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
  ${state.showSettings ? renderSettings() : ''}
  ${state.showAbout ? renderAbout() : ''}
</div>`;
  }

  function renderPassenger(fare, canBook) {
    return `
    <div class="map-area">
      <div class="map-grid"></div>
      <div class="map-center">
        <div style="position:relative">
          <div class="ping"></div>
          <div class="map-pin">📍</div>
        </div>
        <div class="map-label">${state.coords ? 'GPS ACTIVE' : 'IKAW DITO'}</div>
      </div>
      ${
        state.status !== 'idle'
          ? `
      <div style="position:absolute;top:30%;left:54%">
        <div class="map-pin" style="width:36px;height:36px;background:#fff;animation:bounce 1s infinite">🛵</div>
      </div>`
          : ''
      }
      <div class="map-controls">
        <button class="map-btn" data-action="use-location" title="Current location" ${state.locLoading ? 'disabled' : ''}>
          ${state.locLoading ? '⏳' : '📍'}
        </button>
        <button class="map-btn" data-action="center">🎯</button>
      </div>
      ${
        state.status === 'ontheway'
          ? `
      <div class="tracking-bar">
        <div class="dot">🛵</div>
        <div style="flex:1">
          <p class="text-xs text-muted">LIVE TRACKING ${state.currentBooking ? '• ' + state.currentBooking.id.slice(0, 6) : ''}</p>
          <p class="font-bold text-sm">${Math.round(100 - state.progress)}% • Papunta na</p>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${state.progress}%"></div></div>
      </div>`
          : ''
      }
      ${
        state.offline
          ? `<div style="position:absolute;bottom:16px;left:16px;background:#f59e0b;color:#000;font-size:10px;font-weight:900;padding:6px 12px;border-radius:9999px">📡 OFFLINE</div>`
          : ''
      }
    </div>

    <div class="booking-card">
      <div class="route-row">
        <div class="route-dots">
          <div class="dot-green"></div>
          <div class="dot-line"></div>
          <div class="dot-white"></div>
        </div>
        <div class="fields">
          <div class="field">
            <label>PANGALAN MO</label>
            <div class="input-wrap">
              <span>👤</span>
              <input id="name-input" value="${esc(state.name)}" placeholder="Pangalan" autocomplete="name">
            </div>
          </div>
          <div class="field field-suggest">
            <div class="field-label-row">
              <label>SAAN KA? (PICKUP)</label>
              <button type="button" class="loc-btn" data-action="use-location" ${state.locLoading ? 'disabled' : ''}>
                ${state.locLoading ? '…' : '📍 Current location'}
              </button>
            </div>
            <div class="input-wrap">
              <span>📍</span>
              <input id="pickup-input" value="${esc(state.pickup)}" placeholder="Type or use current location" autocomplete="off">
            </div>
            ${suggestDropdown('pickup')}
          </div>
          <div class="field field-suggest">
            <label>SAAN PUNTA? (DROP)</label>
            <div class="input-wrap">
              <span>🧭</span>
              <input id="drop-input" value="${esc(state.drop)}" placeholder="Mag-type para may suggestions…" autocomplete="off">
            </div>
            ${suggestDropdown('drop')}
          </div>
        </div>
      </div>

      <div class="fare-row">
        <div class="fare-info">
          <div class="fare-icon">💰</div>
          <div>
            <p class="fare-label">EST. PAMASAHE • ${hasKey() ? 'SUPABASE' : 'LOCAL'}</p>
            <p class="fare-value">${fare !== null ? '₱' + fare : '—'} <span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.5)">• Cash / GCash</span></p>
          </div>
        </div>
        <div class="km-badge">⚡ ${fare !== null ? '1.2 km' : '— km'}</div>
      </div>
    </div>

    <div class="px-5 mt-6">
      ${
        !hasKey()
          ? `
      <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:20px;padding:20px">
        <p style="color:#fde68a;font-weight:700;font-size:13px">Supabase anon key needed</p>
        <p style="font-size:11px;color:rgba(253,230,138,0.7);margin-top:4px">Tap ⚙️ → paste anon key from Supabase Dashboard</p>
        <button class="btn-primary enabled mt-3" style="width:auto;padding:8px 16px;font-size:11px" data-action="settings">OPEN SETTINGS ⚙️</button>
      </div>`
          : `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:16px">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div style="width:8px;height:8px;border-radius:9999px;background:var(--green)" class="animate-pulse"></div>
            <span class="text-xs text-muted font-bold">LIVE • Supabase</span>
          </div>
          <button class="icon-btn" data-action="refresh" style="width:28px;height:28px">🔄</button>
        </div>
        <p class="text-xs text-muted mt-3">Kapag nag-book ka, lalabas sa rider view via Realtime.</p>
      </div>`
      }
    </div>

    <div class="px-5 mt-6" style="padding-bottom:8px">
      ${
        state.status === 'idle'
          ? `
        <button class="btn-primary ${canBook ? 'enabled' : 'disabled'}" data-action="book" ${!canBook ? 'disabled' : ''}>
          ${state.bookingBusy ? '⏳' : '🛵'}
          ${canBook ? (hasKey() ? 'MAG-BOOK SA SUPABASE' : 'MAG-BOOK NA (DEMO)') + ' • ₱' + fare : 'ILAGAY MUNA PICKUP & DROP'}
        </button>
        ${!canBook ? '<p class="text-xs text-muted text-center mt-3">Ilagay ang pickup at drop para makita ang pamasahe</p>' : ''}
      `
          : ''
      }

      ${
        state.status === 'searching'
          ? `
      <div class="status-card">
        <div class="flex items-center gap-3">
          <div style="width:40px;height:40px;border-radius:9999px;background:#000;display:flex;align-items:center;justify-content:center">
            <div style="width:12px;height:12px;border-radius:9999px;background:var(--green)" class="animate-pulse"></div>
          </div>
          <div style="flex:1">
            <p class="font-bold" style="font-size:14px">Naghahanap ng rider…</p>
            <p class="text-xs" style="color:rgba(0,0,0,0.6)">${hasKey() ? (state.currentBooking ? 'ID ' + state.currentBooking.id.slice(0, 8) : 'Supabase') : 'Demo mode'}</p>
          </div>
          <div class="animate-spin" style="width:20px;height:20px;border:2px solid rgba(0,0,0,0.2);border-top-color:#000;border-radius:9999px"></div>
        </div>
        <div class="flex gap-2 mt-3">
          <button class="btn-primary" style="background:rgba(0,0,0,0.05);color:rgba(0,0,0,0.7);flex:1" data-action="cancel">Cancel</button>
          <button class="btn-primary" style="background:#000;color:#fff;flex:1" data-action="refresh">Refresh</button>
        </div>
      </div>`
          : ''
      }

      ${
        ['assigned', 'ontheway', 'arrived'].includes(state.status)
          ? `
      <div class="status-card arrived">
        <div class="flex items-start justify-between">
          <div class="flex gap-3">
            <div style="width:56px;height:56px;border-radius:9999px;background:#000;display:flex;align-items:center;justify-content:center;border:2px solid #000;font-size:28px">🛵</div>
            <div>
              <p class="text-xs" style="color:rgba(0,0,0,0.4);font-weight:700;letter-spacing:0.1em">${state.status === 'arrived' ? 'NANDITO NA!' : 'RIDER ASSIGNED'}</p>
              <p class="font-black" style="font-size:16px;margin-top:4px">${state.status === 'arrived' ? 'NANDITO NA RIDER MO' : state.currentBooking?.rider_name || 'PAPUNTA NA'}</p>
              <div class="flex items-center gap-2 mt-2">
                <span style="font-size:11px;background:#000;color:#fff;padding:2px 8px;border-radius:9999px;font-weight:700">RIDER • VERIFIED</span>
              </div>
            </div>
          </div>
          <button class="icon-btn" style="background:rgba(0,0,0,0.05);border:none;color:#000" data-action="cancel">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px">
          <div style="background:#F5F5F0;border-radius:12px;padding:10px">
            <p class="text-xs" style="color:rgba(0,0,0,0.4);font-weight:700">ETA</p>
            <p class="font-black" style="font-size:13px">${state.status === 'arrived' ? '0 min' : '3 min'}</p>
          </div>
          <div style="background:#F5F5F0;border-radius:12px;padding:10px">
            <p class="text-xs" style="color:rgba(0,0,0,0.4);font-weight:700">FARE</p>
            <p class="font-black" style="font-size:13px">₱${state.currentBooking?.fare || fare || '—'}</p>
          </div>
          <div style="background:#F5F5F0;border-radius:12px;padding:10px">
            <p class="text-xs" style="color:rgba(0,0,0,0.4);font-weight:700">ID</p>
            <p class="font-black" style="font-size:11px;overflow:hidden;text-overflow:ellipsis">${state.currentBooking?.id?.slice(0, 8) || '—'}</p>
          </div>
        </div>
        ${
          state.status === 'arrived'
            ? `
          <div class="mt-4 bg-green rounded-full py-3 text-center font-black" style="display:flex;align-items:center;justify-content:center;gap:8px">✅ RIDER NASA LOCATION NA</div>
          <button class="btn-primary mt-2" style="background:#000;color:#fff" data-action="cancel">OK, Salamat!</button>
        `
            : `
          <div class="mt-4" style="height:6px;background:rgba(0,0,0,0.1);border-radius:9999px;overflow:hidden">
            <div style="height:100%;background:var(--green);width:${state.status === 'assigned' ? 20 : state.progress}%;transition:width 0.2s"></div>
          </div>
          <div class="flex gap-2 mt-4">
            <button class="btn-primary" style="flex:1;background:transparent;border:1px solid #000;color:#000">💬 Chat</button>
            <button class="btn-primary" style="flex:1;background:#000;color:#fff">📞 Tawagan</button>
          </div>
        `
        }
      </div>`
          : ''
      }

      ${renderCreator()}
    </div>`;
  }

  function renderRider() {
    return `
    <div class="rider-header">
      <div>
        <p class="text-xs text-muted font-bold" style="letter-spacing:0.1em">TODAY'S KITA • ${state.conn === 'connected' ? 'LIVE' : 'OFFLINE'}</p>
        <p style="font-size:28px;font-weight:900;line-height:1;margin-top:4px">₱0 <span style="font-size:14px;font-weight:500;color:rgba(255,255,255,0.4)">• ${state.liveBookings.length} live</span></p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold px-3 py-1.5 rounded-full border ${state.online ? 'bg-green' : ''}" style="${state.online ? '' : 'background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);border-color:rgba(255,255,255,0.1)'}">${state.online ? 'ONLINE' : 'OFFLINE'}</span>
        <div class="toggle-online ${state.online ? 'on' : 'off'}" data-action="toggle-online">
          <div class="toggle-knob"></div>
        </div>
      </div>
    </div>

    <div class="rider-stats px-5">
      <div class="stat-box"><p class="label">LIVE BOOKINGS</p><p class="value">${state.liveBookings.length}</p></div>
      <div class="stat-box"><p class="label">ORAS ONLINE</p><p class="value">${state.online ? 'Live' : '0h'}</p></div>
      <div class="stat-box"><p class="label">SUPABASE</p><p class="value">${state.conn === 'connected' ? '✓ Live' : '—'}</p></div>
    </div>

    <div class="mx-5 mt-4" style="height:180px;border-radius:20px;background:var(--card2);border:1px solid rgba(255,255,255,0.06);position:relative;overflow:hidden;margin-left:1.25rem;margin-right:1.25rem">
      <div class="map-grid" style="opacity:0.05;background-size:28px 28px"></div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <div class="text-center">
          <div style="width:56px;height:56px;margin:0 auto;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid;font-size:28px;${state.online ? 'background:var(--green);border-color:#000' : 'background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.1)'}">🛵</div>
          <p class="mt-3 text-xs font-bold text-muted">${state.online ? `IKAW AY ONLINE • ${state.liveBookings.length} BOOKING(S)` : 'OFFLINE • HINDI MAKIKITA'}</p>
          <p class="text-xs text-muted">${state.conn === 'connected' ? 'Supabase Realtime ready' : 'Set anon key in ⚙️'}</p>
        </div>
      </div>
    </div>

    <div class="px-5 mt-5" style="padding-bottom:8px">
      ${
        !state.online
          ? `
      <div style="background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:20px;padding:32px;text-align:center">
        <p class="font-bold" style="font-size:14px">Naka-offline ka</p>
        <p class="text-sm text-muted mt-2">Walang booking, mag-online ka muna.</p>
        <button class="btn-primary enabled mt-5" style="width:auto;padding:10px 24px" data-action="toggle-online">MAG-ONLINE</button>
      </div>`
          : !hasKey()
            ? `
      <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:20px;padding:20px;text-align:center">
        <p style="color:#fde68a;font-weight:700">Anon key missing</p>
        <button class="btn-primary enabled mt-3" style="width:auto;padding:8px 16px;font-size:11px" data-action="settings">OPEN SETTINGS</button>
      </div>`
            : state.liveBookings.length === 0
              ? `
      <div style="background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:20px;padding:32px;text-align:center">
        <p class="font-bold" style="font-size:14px">Wala pang booking</p>
        <p class="text-sm text-muted mt-2">Nakaabang ka na. Lalabas dito live bookings.</p>
        <button class="text-xs text-muted mt-4" data-action="refresh" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer">🔄 Refresh bookings</button>
      </div>`
              : `
      <div class="booking-list">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-black text-xs" style="letter-spacing:0.05em">LIVE BOOKINGS • ${state.liveBookings.length}</h3>
          <button class="text-xs text-green font-bold" data-action="refresh" style="background:none;border:none;cursor:pointer;color:var(--green)">REFRESH</button>
        </div>
        ${state.liveBookings
          .map(
            (b) => `
        <div class="booking-item">
          <div class="flex items-start justify-between">
            <div class="flex gap-3">
              <div style="width:40px;height:40px;border-radius:9999px;background:var(--green);display:flex;align-items:center;justify-content:center;color:#000;font-weight:900;font-size:12px">${(b.passenger_name || '??').slice(0, 2).toUpperCase()}</div>
              <div>
                <p class="font-bold text-sm">${esc(b.passenger_name)} • ₱${b.fare}</p>
                <p class="text-xs text-muted mt-1">${esc(b.pickup)} → ${esc(b.drop_location)}</p>
                <p class="text-xs text-muted mt-1">${b.created_at ? new Date(b.created_at).toLocaleTimeString() : 'now'} • ${b.id.slice(0, 8)}</p>
              </div>
            </div>
            <div style="width:8px;height:8px;border-radius:9999px;background:var(--green)" class="animate-pulse"></div>
          </div>
          <div class="actions">
            <button class="btn-accept" data-accept="${b.id}">ACCEPT</button>
            <button class="btn-ontheway" data-ontheway="${b.id}">ON THE WAY</button>
            <button class="btn-arrived" data-arrived="${b.id}">ARRIVED</button>
          </div>
        </div>`
          )
          .join('')}
      </div>`
      }

      ${renderCreator()}
    </div>`;
  }

  function renderCreator() {
    return `
    <p class="credit-line">Kandong v${cfg.VERSION} · E.M. Perez</p>`;
  }

  function renderSettings() {
    return `
    <div class="modal-overlay" data-action="close-settings">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-handle"><span></span></div>
        <div class="modal-header">
          <div class="flex items-center gap-3">
            <div style="width:40px;height:40px;border-radius:9999px;background:var(--green);display:flex;align-items:center;justify-content:center;font-size:18px">⚙️</div>
            <div>
              <h2 class="font-black" style="font-size:16px">Supabase Settings</h2>
              <p class="text-muted text-xs">Paste anon key • Production ready</p>
            </div>
          </div>
          <button class="icon-btn" data-action="close-settings">✕</button>
        </div>
        <div class="modal-body">
          <div class="status-pill ${state.conn === 'connected' ? 'connected' : state.conn === 'error' ? 'error' : 'warning'}">
            <span>${state.conn === 'connected' ? '🟢 Connected' : state.conn === 'error' ? '🔴 Error' : '🟡 Not configured'}</span>
            <span class="text-xs text-muted" style="margin-left:auto;overflow:hidden;text-overflow:ellipsis;max-width:160px">${cfg.SUPABASE_URL}</span>
          </div>
          ${state.connError ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px;font-size:11px;color:#fca5a5">${esc(state.connError)}</div>` : ''}
          <div>
            <label class="text-xs font-black text-muted" style="letter-spacing:0.1em">ANON PUBLIC KEY</label>
            <p class="text-xs text-muted mt-1 mb-2">Supabase → Project Settings → API → anon public</p>
            <div class="input-wrap">
              <span>🔑</span>
              <input id="anon-key-input" type="password" placeholder="eyJhbGciOi…" value="${esc(localStorage.getItem('kandong_anon_key') || '')}">
            </div>
            <div class="flex gap-2 mt-3">
              <button class="btn-primary enabled" style="flex:1" data-action="save-key">SAVE & CONNECT</button>
              <button class="btn-primary" style="flex:1;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.1)" data-action="clear-key">CLEAR</button>
            </div>
          </div>
          <div style="background:#0F0F0F;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-black text-muted">SQL SETUP</p>
              <button class="text-xs text-green font-bold" data-action="copy-sql" style="background:none;border:none;cursor:pointer;color:var(--green)">📋 COPY SQL</button>
            </div>
            <pre style="font-size:9px;line-height:1.4;color:rgba(255,255,255,0.5);background:#000;border-radius:8px;padding:12px;overflow-x:auto;border:1px solid rgba(255,255,255,0.05)">See sql/bookings.sql</pre>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderAbout() {
    return `
    <div class="modal-overlay" data-action="close-about">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-handle"><span></span></div>
        <div class="modal-header">
          <div class="flex items-center gap-3">
            <div style="width:40px;height:40px;border-radius:9999px;background:var(--green);display:flex;align-items:center;justify-content:center;font-size:18px">ℹ️</div>
            <div>
              <h2 class="font-black" style="font-size:16px">About Kandong</h2>
              <p class="text-muted text-xs">Habal Ride • Supabase • PWA</p>
            </div>
          </div>
          <button class="icon-btn" data-action="close-about">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="line-height:1.5">
            Habal booking app with live Supabase bookings, installable PWA, current location, and place suggestions.
          </p>
          <p class="text-xs text-muted text-center" style="opacity:0.5">v${cfg.VERSION} · E.M. Perez</p>
        </div>
      </div>
    </div>`;
  }

  document.addEventListener('click', (e) => {
    const suggestBtn = e.target.closest('[data-suggest-idx]');
    if (suggestBtn) {
      const idx = parseInt(suggestBtn.dataset.suggestIdx, 10);
      if (state.suggestions[idx]) pickSuggestion(state.suggestions[idx]);
      return;
    }

    if (!e.target.closest('.field-suggest') && !e.target.closest('[data-action="use-location"]')) {
      if (state.suggestField) {
        closeSuggest();
        render();
      }
    }

    const t = e.target.closest(
      '[data-action], [data-nav], [data-accept], [data-ontheway], [data-arrived]'
    );
    if (!t) return;

    if (t.dataset.action === 'mode-passenger') setMode('passenger');
    else if (t.dataset.action === 'mode-rider') setMode('rider');
    else if (t.dataset.action === 'settings') {
      state.showSettings = true;
      render();
    } else if (t.dataset.action === 'about') {
      state.showAbout = true;
      render();
    } else if (t.dataset.action === 'close-settings') {
      state.showSettings = false;
      render();
    } else if (t.dataset.action === 'close-about') {
      state.showAbout = false;
      render();
    } else if (t.dataset.action === 'install') installApp();
    else if (t.dataset.action === 'dismiss-install') {
      state.showInstall = false;
      render();
    } else if (t.dataset.action === 'book') createBooking();
    else if (t.dataset.action === 'cancel') cancelBooking();
    else if (t.dataset.action === 'refresh') {
      fetchLiveBookings();
      toast('Refreshed');
    } else if (t.dataset.action === 'toggle-online') toggleOnline();
    else if (t.dataset.action === 'save-key') saveKey();
    else if (t.dataset.action === 'clear-key') clearKey();
    else if (t.dataset.action === 'copy-sql') copySQL();
    else if (t.dataset.action === 'use-location') useCurrentLocation();
    else if (t.dataset.action === 'center') {
      if (state.coords) toast('🎯 Centered on GPS');
      else useCurrentLocation();
    } else if (t.dataset.nav) {
      state.nav = t.dataset.nav;
      toast(t.dataset.nav === 'Home' ? 'Home • Kandong' : `${t.dataset.nav} • Coming soon`);
      render();
    } else if (t.dataset.accept) {
      const b = state.liveBookings.find((x) => x.id === t.dataset.accept);
      if (b) acceptBooking(b);
    } else if (t.dataset.ontheway) {
      const b = state.liveBookings.find((x) => x.id === t.dataset.ontheway);
      if (b) setOnTheWay(b);
    } else if (t.dataset.arrived) {
      const b = state.liveBookings.find((x) => x.id === t.dataset.arrived);
      if (b) setArrived(b);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'name-input') {
      state.name = e.target.value;
      return;
    }
    if (e.target.id === 'pickup-input') {
      state.pickup = e.target.value;
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => openSuggest('pickup', state.pickup), 120);
      return;
    }
    if (e.target.id === 'drop-input') {
      state.drop = e.target.value;
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => openSuggest('drop', state.drop), 120);
      return;
    }
  });

  document.addEventListener('focusin', (e) => {
    if (e.target.id === 'pickup-input') openSuggest('pickup', state.pickup);
    if (e.target.id === 'drop-input') openSuggest('drop', state.drop);
  });

  function init() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      state.showInstall = true;
      render();
    });
    window.addEventListener('appinstalled', () => {
      state.isInstalled = true;
      state.showInstall = false;
      state.deferredPrompt = null;
      toast('Installed! Check your app drawer 🛵');
      render();
    });
    state.isInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    window.addEventListener('online', () => {
      state.offline = false;
      render();
    });
    window.addEventListener('offline', () => {
      state.offline = true;
      render();
    });

    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'rider') state.mode = 'rider';

    connect();
    render();

    if (!state.isInstalled) {
      setTimeout(() => {
        state.showInstall = true;
        render();
      }, 1800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
