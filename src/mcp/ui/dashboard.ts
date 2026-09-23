export interface DashboardPageOptions {
  /** The dashboard signs in via Supabase's own hosted login, client-side, using this project's
   * public anon key — safe to embed, per Supabase's own design. */
  url: string;
  anonKey: string;
}

/**
 * Read-only day-by-day itinerary dashboard. A single static HTML document
 * (Tailwind via CDN, vanilla JS) that renders whatever /api/trips and
 * /api/trips/:id/itinerary return — no build step, matching how this
 * codebase avoids one elsewhere.
 */
export function renderDashboardPage(opts: DashboardPageOptions): string {
  // Server-controlled values only (a CLI flag / env var, not user input), but escape `</` all
  // the same so nothing here can prematurely close this inline <script> tag.
  const supabaseConfigJson = JSON.stringify({ url: opts.url, anonKey: opts.anonKey }).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Tripkit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script>
  window.__TRIPKIT_SUPABASE__ = ${supabaseConfigJson};
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      },
    },
  };
</script>
<style>
  html, body { background: #0a0a0b; }
  ::selection { background: #4f7cff55; }
  select { color-scheme: dark; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2a2a2e; border-radius: 999px; }
</style>
</head>
<body class="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased">

  <header class="sticky top-0 z-10 border-b border-neutral-800/80 bg-neutral-950/85 backdrop-blur">
    <div class="mx-auto max-w-3xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2 min-w-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5 text-indigo-400 shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 21 3l-4.5 16.5-4-8-8-4Z"/>
        </svg>
        <span class="font-semibold tracking-tight truncate">Tripkit</span>
      </div>
      <select id="tripSelect" class="max-w-[60%] sm:max-w-xs truncate rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"></select>
    </div>
  </header>

  <main class="mx-auto max-w-3xl px-4 sm:px-6 py-8">
    <div id="status" class="text-sm text-neutral-500"></div>
    <div id="login" class="hidden max-w-sm mx-auto mt-16">
      <h2 class="text-lg font-semibold mb-4 text-center text-neutral-100">Sign in to Tripkit</h2>
      <form id="loginForm" class="space-y-3">
        <input id="loginEmail" type="email" placeholder="Email" autocomplete="username" required
          class="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
        <input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password" required
          class="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
        <button type="submit" class="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-medium text-white">Sign in</button>
        <p id="loginError" class="hidden text-sm text-red-400"></p>
      </form>
    </div>
    <div id="app" class="hidden">
      <section class="mb-10">
        <div class="flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1">
          <h1 id="tripName" class="text-2xl sm:text-3xl font-semibold tracking-tight text-white"></h1>
          <div id="tripDates" class="text-sm text-neutral-400 whitespace-nowrap"></div>
        </div>
        <p id="tripNotes" class="mt-2 text-sm text-neutral-400"></p>
        <div id="travelers" class="mt-3 flex flex-wrap gap-1.5"></div>
      </section>

      <section id="timeline" class="relative"></section>

      <details id="packingSection" class="hidden mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40 open:bg-neutral-900/60">
        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-neutral-300 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-4 h-4 text-neutral-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7h18v12H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Packing list
          <span id="packingCount" class="text-neutral-500 font-normal"></span>
        </summary>
        <div id="packingBody" class="px-4 pb-4 space-y-4"></div>
      </details>
    </div>
  </main>

<script>
(function () {
  const ICONS = {
    plane: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12 21 3l-4.5 16.5-4-8-8-4Z"/></svg>',
    bed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V7a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v3M13 10h6a2 2 0 0 1 2 2v0"/></svg>',
    users: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M13 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    pin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-3 h-3 inline shrink-0"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s7-7.373 7-12a7 7 0 1 0-14 0c0 4.627 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  };

  const BLOCK_STYLES = {
    activity: { badge: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30', dot: 'bg-indigo-500' },
    meal:     { badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', dot: 'bg-amber-500' },
    transit:  { badge: 'bg-sky-500/15 text-sky-300 ring-sky-500/30', dot: 'bg-sky-500' },
    buffer:   { badge: 'bg-slate-500/15 text-slate-300 ring-slate-500/30', dot: 'bg-slate-500' },
    other:    { badge: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30', dot: 'bg-zinc-500' },
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Any place/address text on the page becomes a clickable maps search link, built
  // straight from that text (no stored coordinates needed) -- tripkit_place_lookup
  // is how an agent resolves a vague name into a real address worth linking.
  function mapsUrl(text) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(text);
  }
  function mapsLink(text, label) {
    return '<a href="' + mapsUrl(text) + '" target="_blank" rel="noopener noreferrer" ' +
      'class="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-neutral-200">' +
      ICONS.pin + '<span>' + esc(label ?? text) + '</span></a>';
  }

  // Addresses (a day block's place, a stay's address) are secondary detail, not the
  // line's headline -- collapsed by default behind a small pin+"Map" toggle so a long
  // address doesn't dominate the row; click it open to reveal the full text as a link.
  function mapsDetails(text) {
    return '<details class="inline-block align-top">' +
      '<summary class="list-none cursor-pointer inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300">' +
        ICONS.pin + '<span>Map</span>' +
      '</summary>' +
      '<div class="mt-1 text-[11px]">' +
        '<a href="' + mapsUrl(text) + '" target="_blank" rel="noopener noreferrer" ' +
          'class="text-neutral-400 hover:text-neutral-200 underline decoration-dotted underline-offset-2">' +
          esc(text) + '</a>' +
      '</div>' +
    '</details>';
  }

  function fmtRange(startDate, endDate) {
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    const start = new Date(startDate + 'T00:00:00').toLocaleDateString(undefined, opts);
    const end = new Date(endDate + 'T00:00:00').toLocaleDateString(undefined, opts);
    return start === end ? start : \`\${start} – \${end}\`;
  }

  function fmtDayNum(iso) { return iso.slice(8, 10); }
  function fmtMonth(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' }).toUpperCase(); }
  function fmtWeekday(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }); }

  // Formats HH:MM as 12h with AM/PM, without ever converting through a timezone: a
  // flight/stay's own local time (parsed straight from its ISO string's clock digits,
  // ignoring the viewer's browser timezone) or a day block's plain HH:MM.
  function fmt12h(hh, mm) {
    const h = Number(hh);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + mm + ' ' + period;
  }
  function fmtTime(isoDateTime) {
    const match = /T(\\d{2}):(\\d{2})/.exec(isoDateTime);
    if (!match) return isoDateTime;
    return fmt12h(match[1], match[2]);
  }

  var supabaseConfig = window.__TRIPKIT_SUPABASE__;
  var supabaseClient = supabaseConfig && window.supabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

  function showLogin() {
    document.getElementById('status').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
  }
  function hideLogin() {
    document.getElementById('login').classList.add('hidden');
  }

  async function api(path) {
    const headers = {};
    if (supabaseClient) {
      const { data } = await supabaseClient.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) { showLogin(); throw new Error('unauthorized'); }
      headers['Authorization'] = 'Bearer ' + token;
    }
    const res = await fetch(path, { credentials: 'include', headers });
    if (res.status === 401) {
      if (supabaseClient) { await supabaseClient.auth.signOut(); showLogin(); }
      else { window.location.reload(); }
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  // One row per flight, always showing both legs together as a pair (Departs ...
  // \\u2192 Arrives ...) rather than splitting a flight's departure and arrival into
  // separate rows that end up in separate groups on the day card. Whichever leg
  // falls on the day being rendered is emphasized; the other is muted for context.
  function flightLegBadge(label, active) {
    const style = active
      ? 'bg-teal-500/15 text-teal-300 ring-teal-500/30'
      : 'bg-neutral-800/60 text-neutral-500 ring-neutral-700/50';
    return '<span class="px-1.5 py-0.5 rounded-full ring-1 text-[11px] ' + style + '">' + label + '</span>';
  }

  function flightRow(f, departsToday, arrivesToday) {
    const extras = [
      f.confirmation ? 'Conf ' + esc(f.confirmation) : '',
      f.seat ? 'Seat ' + esc(f.seat) : '',
    ].filter(Boolean).join(' \\u00b7 ');
    return \`
      <div class="flex items-start gap-3 rounded-lg bg-teal-500/10 ring-1 ring-teal-500/20 px-3 py-2.5">
        <div class="text-teal-300 mt-0.5">\${ICONS.plane}</div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-teal-200">\${esc(f.airline)} \${esc(f.flightNumber)} \\u00b7 \${mapsLink(f.departureAirport + ' airport', f.departureAirport)} \\u2192 \${mapsLink(f.arrivalAirport + ' airport', f.arrivalAirport)}</div>
          <div class="text-xs text-neutral-400 mt-1 flex items-center gap-1.5 flex-wrap">
            \${flightLegBadge('Departs', departsToday)}
            <span class="\${departsToday ? 'text-neutral-200 font-medium' : 'text-neutral-500'}">\${fmtTime(f.departureTime)}</span>
            <span class="text-neutral-600">\\u2192</span>
            \${flightLegBadge('Arrives', arrivesToday)}
            <span class="\${arrivesToday ? 'text-neutral-200 font-medium' : 'text-neutral-500'}">\${fmtTime(f.arrivalTime)}</span>
            \${extras ? '<span class="text-neutral-600">\\u00b7</span><span>' + extras + '</span>' : ''}
          </div>
        </div>
      </div>\`;
  }

  function stayRow(s, direction) {
    const label = direction === 'checkin' ? 'Check-in' : 'Check-out';
    const time = direction === 'checkin' ? s.checkIn : s.checkOut;
    return \`
      <div class="flex items-start gap-3 rounded-lg bg-fuchsia-500/10 ring-1 ring-fuchsia-500/20 px-3 py-2.5">
        <div class="text-fuchsia-300 mt-0.5">\${ICONS.bed}</div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-fuchsia-200">\${esc(s.name)}</div>
          <div class="text-xs text-neutral-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>\${label} \${fmtTime(time)}</span>
            \${s.address ? mapsDetails(s.address) : ''}
          </div>
        </div>
      </div>\`;
  }

  function blockRow(block, isLast) {
    const style = BLOCK_STYLES[block.type] || BLOCK_STYLES.other;
    const [startH, startM] = block.startTime.split(':');
    const [endH, endM] = block.endTime.split(':');
    return \`
      <div class="flex gap-3">
        <div class="flex flex-col items-center w-4 pt-1.5 shrink-0">
          <span class="h-2.5 w-2.5 rounded-full \${style.dot} ring-4 ring-neutral-950"></span>
          \${isLast ? '' : '<span class="w-px flex-1 bg-neutral-800 mt-1"></span>'}
        </div>
        <div class="flex-1 min-w-0 pb-5">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="text-sm font-medium text-neutral-200">\${fmt12h(startH, startM)}\\u2013\${fmt12h(endH, endM)}</span>
            <span class="text-[11px] px-1.5 py-0.5 rounded-full ring-1 \${style.badge} capitalize">\${esc(block.type)}</span>
          </div>
          <div class="mt-0.5 text-neutral-100 font-medium">\${esc(block.title)}</div>
          \${block.place ? '<div class="mt-0.5">' + mapsDetails(block.place) + '</div>' : ''}
          \${block.notes ? '<div class="text-sm text-neutral-500 mt-0.5">' + esc(block.notes) + '</div>' : ''}
        </div>
      </div>\`;
  }

  // A flight departing and arriving the same calendar date appears in both
  // entry.flightsDeparting and entry.flightsArriving; merge by id so it renders as
  // one paired row instead of two separate ones.
  function pairFlightsForDay(entry) {
    const byId = new Map();
    for (const f of entry.flightsDeparting) byId.set(f.id, { flight: f, departsToday: true, arrivesToday: false });
    for (const f of entry.flightsArriving) {
      const existing = byId.get(f.id);
      if (existing) existing.arrivesToday = true;
      else byId.set(f.id, { flight: f, departsToday: false, arrivesToday: true });
    }
    return [...byId.values()];
  }

  function dayCard(entry, isLastDay) {
    const blocks = (entry.day && entry.day.blocks ? entry.day.blocks.slice() : []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const flights = pairFlightsForDay(entry);
    const hasContent = blocks.length || flights.length || entry.staysCheckingIn.length || entry.staysCheckingOut.length;

    const chips = [
      ...flights.map(({ flight, departsToday, arrivesToday }) => flightRow(flight, departsToday, arrivesToday)),
      ...entry.staysCheckingIn.map((s) => stayRow(s, 'checkin')),
      ...entry.staysCheckingOut.map((s) => stayRow(s, 'checkout')),
    ].join('');

    return \`
      <div class="flex gap-4 sm:gap-6 \${isLastDay ? '' : 'pb-2'}">
        <div class="shrink-0 w-14 text-center pt-1">
          <div class="text-[11px] tracking-wide text-neutral-500">\${fmtMonth(entry.date)}</div>
          <div class="text-2xl font-semibold text-neutral-100 leading-tight">\${fmtDayNum(entry.date)}</div>
          <div class="text-[11px] text-neutral-500">\${fmtWeekday(entry.date)}</div>
        </div>
        <div class="flex-1 min-w-0 pb-10 border-b border-neutral-900 last:border-b-0">
          \${entry.day && entry.day.title ? '<h3 class="text-base font-semibold text-neutral-100 mb-1">' + esc(entry.day.title) + '</h3>' : ''}
          \${entry.day && entry.day.notes ? '<p class="text-sm text-neutral-400 mb-3">' + esc(entry.day.notes) + '</p>' : ''}
          \${chips ? '<div class="space-y-2 mb-4">' + chips + '</div>' : ''}
          \${blocks.length ? '<div>' + blocks.map((b, i) => blockRow(b, i === blocks.length - 1)).join('') + '</div>' : ''}
          \${!hasContent ? '<div class="text-sm text-neutral-600 italic">No plans yet</div>' : ''}
        </div>
      </div>\`;
  }

  function renderPacking(items) {
    const section = document.getElementById('packingSection');
    const body = document.getElementById('packingBody');
    const count = document.getElementById('packingCount');
    if (!items.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    const packed = items.filter((i) => i.packed).length;
    count.textContent = \`(\${packed}/\${items.length} packed)\`;

    const byCategory = new Map();
    for (const item of items) {
      const list = byCategory.get(item.category) || [];
      list.push(item);
      byCategory.set(item.category, list);
    }

    body.innerHTML = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, categoryItems]) => \`
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">\${esc(category)}</div>
          <ul class="space-y-1">
            \${categoryItems.map((item) => \`
              <li class="flex items-center gap-2 text-sm \${item.packed ? 'text-neutral-500 line-through' : 'text-neutral-200'}">
                <span class="inline-block h-3.5 w-3.5 rounded-sm border \${item.packed ? 'bg-indigo-500 border-indigo-500' : 'border-neutral-600'}"></span>
                \${esc(item.label)}\${item.quantity > 1 ? ' \\u00d7' + item.quantity : ''}
              </li>\`).join('')}
          </ul>
        </div>\`)
      .join('');
  }

  function renderTrip(bundle) {
    document.getElementById('tripName').textContent = bundle.trip.name;
    document.getElementById('tripDates').textContent = fmtRange(bundle.trip.startDate, bundle.trip.endDate) + ' \\u00b7 ' + bundle.trip.homeTimezone;
    const notesEl = document.getElementById('tripNotes');
    notesEl.textContent = bundle.trip.notes || '';
    notesEl.classList.toggle('hidden', !bundle.trip.notes);

    const travelers = document.getElementById('travelers');
    travelers.innerHTML = bundle.people.map((p) => \`
      <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-neutral-900 ring-1 ring-neutral-800 text-neutral-300">
        \${ICONS.users}\${esc(p.name)}
      </span>\`).join('');

    const timeline = document.getElementById('timeline');
    timeline.innerHTML = bundle.days.map((d, i) => dayCard(d, i === bundle.days.length - 1)).join('');

    renderPacking(bundle.packingItems);

    document.getElementById('status').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  async function loadTrip(id) {
    const bundle = await api('/api/trips/' + encodeURIComponent(id) + '/itinerary');
    renderTrip(bundle);
  }

  async function init() {
    if (supabaseClient) {
      const { data } = await supabaseClient.auth.getSession();
      if (!data || !data.session) { showLogin(); return; }
    }
    hideLogin();

    const status = document.getElementById('status');
    status.classList.remove('hidden');
    try {
      const trips = await api('/api/trips');
      if (!trips.length) {
        status.textContent = 'No trips yet. Add one through Tripkit\\'s MCP tools and refresh this page.';
        return;
      }
      trips.sort((a, b) => a.startDate.localeCompare(b.startDate));

      const select = document.getElementById('tripSelect');
      select.innerHTML = trips.map((t) => \`<option value="\${esc(t.id)}">\${esc(t.name)}</option>\`).join('');
      select.addEventListener('change', () => loadTrip(select.value));

      await loadTrip(trips[0].id);
    } catch (err) {
      if (err && err.message === 'unauthorized') return;
      status.textContent = 'Could not load trips: ' + (err && err.message ? err.message : err);
    }
  }

  if (supabaseClient) {
    document.getElementById('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errorEl = document.getElementById('loginError');
      errorEl.classList.add('hidden');
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        return;
      }
      init();
    });
  }

  init();
})();
</script>
</body>
</html>`;
}
