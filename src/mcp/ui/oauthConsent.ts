export interface OAuthConsentPageOptions {
  url: string;
  anonKey: string;
}

/**
 * Tripkit's authorization UI for Supabase's OAuth 2.1 Server feature. Supabase issues and signs
 * every token, but per Supabase's own docs (Authentication > OAuth Server > Authorization Path),
 * the *consent screen itself* is the resource server's responsibility, not something Supabase
 * hosts — an MCP client's authorization redirect lands here with an `authorization_id` query
 * param, and this page is what calls `getAuthorizationDetails`/`approveAuthorization` client-side
 * via supabase-js, exactly as https://supabase.com/docs/guides/auth/oauth-server/getting-started
 * describes. Without this route, that redirect just 404s.
 *
 * A separate static HTML document from the dashboard (src/mcp/ui/dashboard.ts) rather than a
 * shared bundle, matching how this codebase keeps each page self-contained with no build step.
 */
export function renderOAuthConsentPage(opts: OAuthConsentPageOptions): string {
  const supabaseConfigJson = JSON.stringify({ url: opts.url, anonKey: opts.anonKey }).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Authorize — Tripkit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script>
  window.__TRIPKIT_SUPABASE__ = ${supabaseConfigJson};
  tailwind.config = { theme: { extend: { fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] } } } };
</script>
<style>
  html, body { background: #0a0a0b; }
</style>
</head>
<body class="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased flex items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div id="status" class="hidden text-sm text-neutral-400 text-center"></div>

    <div id="login" class="hidden">
      <h2 class="text-lg font-semibold mb-4 text-center text-neutral-100">Sign in to Tripkit</h2>
      <form id="loginForm" method="post" class="space-y-3">
        <input id="loginEmail" type="email" placeholder="Email" autocomplete="username" required
          class="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
        <input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password" required
          class="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
        <button type="submit" class="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-medium text-white">Sign in</button>
        <p id="loginError" class="hidden text-sm text-red-400"></p>
      </form>
    </div>

    <div id="consent" class="hidden">
      <div class="flex items-center gap-2 mb-1 justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5 text-indigo-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 21 3l-4.5 16.5-4-8-8-4Z"/>
        </svg>
        <span class="font-semibold tracking-tight">Tripkit</span>
      </div>
      <h2 class="text-lg font-semibold mb-1 text-center text-neutral-100">Authorize <span id="clientName"></span></h2>
      <p class="text-sm text-neutral-400 mb-4 text-center">This app wants to access your Tripkit account.</p>
      <div id="scopesBlock" class="hidden mb-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <div class="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Requested access</div>
        <ul id="scopesList" class="text-sm text-neutral-300 space-y-0.5 list-disc list-inside"></ul>
      </div>
      <div class="flex gap-2">
        <button id="denyBtn" type="button" class="flex-1 rounded-lg border border-neutral-800 hover:bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">Deny</button>
        <button id="approveBtn" type="button" class="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-medium text-white">Approve</button>
      </div>
      <p id="consentError" class="hidden text-sm text-red-400 mt-3 text-center"></p>
    </div>
  </div>

<script>
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var supabaseConfig = window.__TRIPKIT_SUPABASE__;
  var supabaseClient = supabaseConfig && window.supabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

  var params = new URLSearchParams(window.location.search);
  var authorizationId = params.get('authorization_id');

  function showStatus(text) {
    document.getElementById('status').textContent = text;
    document.getElementById('status').classList.remove('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('consent').classList.add('hidden');
  }
  function showLogin() {
    document.getElementById('status').classList.add('hidden');
    document.getElementById('consent').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
  }
  function showConsent() {
    document.getElementById('status').classList.add('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('consent').classList.remove('hidden');
  }

  async function loadAuthorizationDetails() {
    var result = await supabaseClient.auth.oauth.getAuthorizationDetails(authorizationId);
    if (result.error) {
      showStatus('This authorization request is invalid or has expired. Ask the app to try connecting again.');
      return;
    }
    var details = result.data;
    if (!details) {
      showStatus('Tripkit could not load this authorization request. Ask the app to try connecting again.');
      return;
    }
    if (details.redirect_url && !details.client) {
      // Supabase's own signal that this Account already approved this exact request -- nothing
      // left for this page to do but send the browser straight back to the requesting app.
      window.location.href = details.redirect_url;
      return;
    }
    document.getElementById('clientName').textContent = (details.client && details.client.name) || 'this app';
    var scopes = ((details.scope || '') + '').trim();
    if (scopes) {
      document.getElementById('scopesList').innerHTML = scopes.split(' ').map(function (s) {
        return '<li>' + esc(s) + '</li>';
      }).join('');
      document.getElementById('scopesBlock').classList.remove('hidden');
    }
    showConsent();
  }

  async function decide(approve) {
    var errorEl = document.getElementById('consentError');
    errorEl.classList.add('hidden');
    try {
      var result = approve
        ? await supabaseClient.auth.oauth.approveAuthorization(authorizationId)
        : await supabaseClient.auth.oauth.denyAuthorization(authorizationId);
      if (result.error) {
        errorEl.textContent = result.error.message;
        errorEl.classList.remove('hidden');
        return;
      }
      window.location.href = result.data.redirect_url;
    } catch (err) {
      // A rejected promise (offline, DNS failure, ...) rather than a clean { error } result --
      // without this, the click would just do nothing with no feedback at all.
      errorEl.textContent = 'Something went wrong (' + (err && err.message ? err.message : 'network error') + '). Try again.';
      errorEl.classList.remove('hidden');
    }
  }

  async function init() {
    if (!supabaseClient) { showStatus('Tripkit is misconfigured (no Supabase client). Contact the trip Owner.'); return; }
    if (!authorizationId) { showStatus('Missing authorization request. Ask the app to try connecting again.'); return; }

    try {
      var { data } = await supabaseClient.auth.getSession();
      if (!data || !data.session) { showLogin(); return; }
      await loadAuthorizationDetails();
    } catch (err) {
      showStatus('Something went wrong loading this page (' + (err && err.message ? err.message : 'network error') + '). Reload to try again.');
    }
  }

  document.getElementById('loginForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var email = document.getElementById('loginEmail').value;
    var password = document.getElementById('loginPassword').value;
    var errorEl = document.getElementById('loginError');
    errorEl.classList.add('hidden');
    try {
      var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        errorEl.textContent = result.error.message;
        errorEl.classList.remove('hidden');
        return;
      }
      await loadAuthorizationDetails();
    } catch (err) {
      errorEl.textContent = 'Something went wrong (' + (err && err.message ? err.message : 'network error') + '). Try again.';
      errorEl.classList.remove('hidden');
    }
  });
  document.getElementById('approveBtn').addEventListener('click', function () { decide(true); });
  document.getElementById('denyBtn').addEventListener('click', function () { decide(false); });

  init();
})();
</script>
</body>
</html>`;
}
