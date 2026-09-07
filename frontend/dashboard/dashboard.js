const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const API_ORIGIN = String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
const apiUrl = path => `${API_ORIGIN}/api${path}`;

async function api(path, { method, body } = {}) {
  const options = { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'include', headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(apiUrl(path), options);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Backend unavailable. Start the Go server and PostgreSQL.'); }
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('is-error', error);
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

let user = null;
let timer = 0;
let busy = false;

function setSessionLabel() {
  $('session-label').innerHTML = user
    ? `<i></i> ${escape(user.username)} · ADMIN`
    : '<i></i> SIGN IN REQUIRED';
}

function showLogin() {
  user = null;
  $('login-panel').hidden = false;
  $('ops-panel').hidden = true;
  setSessionLabel();
  stopPoll();
}

function showOps() {
  $('login-panel').hidden = true;
  $('ops-panel').hidden = false;
  setSessionLabel();
  refresh();
  startPoll();
}

function startPoll() {
  stopPoll();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh().catch(error => notice(error.message, true));
  }, 5000);
}

function stopPoll() {
  clearInterval(timer);
  timer = 0;
}

function stats(overview) {
  const cards = [
    ['LIVE PLAYERS', overview.livePlayers],
    ['SESSIONS', overview.sessions],
    ['USERS', overview.users],
    ['GROUPS', overview.groups],
    ['RUNNING', overview.runningMatches],
    ['FINISHED', overview.finishedMatches],
  ];
  $('stats').innerHTML = cards.map(([label, value]) => `<div class="stat"><small>${label}</small><strong>${value ?? 0}</strong></div>`).join('');
}

function actions(buttons) {
  return `<div class="row-actions">${buttons.join('')}</div>`;
}

function usersTable(rows) {
  if (!rows.length) return '<div class="table-wrap"><h2>Users</h2><p class="empty">No users.</p></div>';
  return `<div class="table-wrap"><h2>Users</h2><table><thead><tr><th>ID</th><th>USER</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>${rows.map(row => {
    const self = row.id === user.id;
    const active = !row.deactivatedAt;
    const controls = [];
    if (!self && active) controls.push(`<button class="mp-secondary" data-act="deactivate-user" data-id="${row.id}">DEACTIVATE</button>`);
    if (!self && !active) controls.push(`<button class="mp-secondary" data-act="activate-user" data-id="${row.id}">ACTIVATE</button>`);
    if (!self) controls.push(`<button class="mp-danger" data-act="delete-user" data-id="${row.id}">DELETE</button>`);
    return `<tr><td>${row.id}</td><td>${escape(row.username)}</td><td>${row.isAdmin ? 'ADMIN' : 'PLAYER'}</td><td>${active ? 'ACTIVE' : 'DEACTIVATED'}</td><td>${when(row.createdAt)}</td><td>${actions(controls)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function groupsTable(rows) {
  if (!rows.length) return '<div class="table-wrap"><h2>Groups</h2><p class="empty">No groups.</p></div>';
  return `<div class="table-wrap"><h2>Groups</h2><table><thead><tr><th>ID</th><th>NAME</th><th>OWNER</th><th>MEMBERS</th><th>CREATED</th><th></th></tr></thead><tbody>${rows.map(row => {
    const members = (row.members || []).map(m => `${escape(m.username)}${m.status === 'invited' ? ' (invited)' : ''}`).join(', ');
    return `<tr><td>${row.id}</td><td>${escape(row.name)}</td><td>${escape(row.owner)}</td><td>${members || '—'}</td><td>${when(row.createdAt)}</td><td>${actions([`<button class="mp-danger" data-act="delete-group" data-id="${row.id}">DELETE</button>`])}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function matchesTable(rows) {
  if (!rows.length) return '<div class="table-wrap"><h2>Matches</h2><p class="empty">No matches.</p></div>';
  return `<div class="table-wrap"><h2>Matches</h2><table><thead><tr><th>ID</th><th>GROUP</th><th>STATUS</th><th>STARTED</th><th>ENDED</th><th>SCORES</th><th></th></tr></thead><tbody>${rows.map(row => {
    const scores = (row.scores || []).map(s => `${escape(s.username)} ${s.kills}/${s.deaths}`).join(' · ') || '—';
    const abort = row.status === 'running' ? `<button class="mp-danger" data-act="abort-match" data-id="${row.id}">ABORT</button>` : '';
    return `<tr><td>${row.id}</td><td>${escape(row.group)}</td><td>${escape(row.status)}</td><td>${when(row.startedAt)}</td><td>${when(row.endedAt)}</td><td>${scores}</td><td>${actions(abort ? [abort] : [])}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function sessionsTable(rows) {
  if (!rows.length) return '<div class="table-wrap"><h2>Sessions</h2><p class="empty">No active sessions.</p></div>';
  return `<div class="table-wrap"><h2>Sessions</h2><table><thead><tr><th>USER</th><th>EXPIRES</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(row.username)}</td><td>${when(row.expiresAt)}</td><td>${actions([`<button class="mp-danger" data-act="revoke-session" data-id="${escape(row.id)}">REVOKE</button>`])}</td></tr>`).join('')}</tbody></table></div>`;
}

async function refresh() {
  const [overview, users, groups, matches, sessions] = await Promise.all([
    api('/admin/overview'),
    api('/admin/users'),
    api('/admin/groups'),
    api('/admin/matches'),
    api('/admin/sessions'),
  ]);
  stats(overview);
  $('users-table').innerHTML = usersTable(users);
  $('groups-table').innerHTML = groupsTable(groups);
  $('matches-table').innerHTML = matchesTable(matches);
  $('sessions-table').innerHTML = sessionsTable(sessions);
}

async function requireAdmin(account) {
  if (!account?.isAdmin) {
    showLogin();
    throw new Error('Admin access required. Player accounts cannot use this dashboard.');
  }
  user = account;
  notice('');
  showOps();
}

async function restore() {
  try {
    const me = await api('/me');
    await requireAdmin(me);
  } catch (error) {
    showLogin();
    if (error.message && !/Sign in to continue|Session expired|Backend unavailable/.test(error.message)) {
      notice(error.message, true);
    }
  }
}

async function run(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (error) {
    notice(error.message, true);
  } finally {
    busy = false;
  }
}

$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.target);
  run(async () => {
    const account = await api('/login', { body: { username: String(data.get('username') || ''), password: String(data.get('password') || '') } });
    try {
      await requireAdmin(account);
    } catch (error) {
      try { await api('/logout', { method: 'POST', body: {} }); } catch { /* still blocked */ }
      throw error;
    }
  });
});

$('sign-out').onclick = () => run(async () => {
  await api('/logout', { method: 'POST', body: {} });
  notice('Signed out.');
  showLogin();
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  const id = button.dataset.id;
  const confirms = {
    'deactivate-user': 'Deactivate this user? They will be signed out.',
    'activate-user': 'Activate this user?',
    'delete-user': 'Delete this user and the groups they own? This cannot be undone.',
    'delete-group': 'Delete this group and its match history?',
    'abort-match': 'Abort this running match?',
    'revoke-session': 'Revoke this session?',
  };
  if (confirms[act] && !confirm(confirms[act])) return;
  run(async () => {
    if (act === 'deactivate-user') await api(`/admin/users/${id}/deactivate`, { method: 'POST', body: {} });
    if (act === 'activate-user') await api(`/admin/users/${id}/activate`, { method: 'POST', body: {} });
    if (act === 'delete-user') await api(`/admin/users/${id}`, { method: 'DELETE' });
    if (act === 'delete-group') await api(`/admin/groups/${id}`, { method: 'DELETE' });
    if (act === 'abort-match') await api(`/admin/matches/${id}/abort`, { method: 'POST', body: {} });
    if (act === 'revoke-session') await api(`/admin/sessions/${id}`, { method: 'DELETE' });
    await refresh();
  });
});

restore();
