const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createMultiplayer(hooks) {
  const state = { user: null, groups: [], selected: null, groupId: null, socket: null, snapshot: null, connected: false, visible: false };
  let authMode = 'login', polling = false, busy = false, searchVersion = 0;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="multiplayer-open" class="mp-open">MULTIPLAYER ↗</button>
    <section id="lobby" class="lobby" hidden aria-label="Multiplayer lobby">
      <div class="lobby-head"><div><div class="eyebrow">ISLAND WAR / ONLINE</div><h2>Assemble your group.</h2><p>Find your friends. Meet on the island. Three minutes to take the lead.</p></div><button id="lobby-close" class="mp-secondary">BACK TO RANGE ×</button></div>
      <p id="lobby-notice" role="status"></p>
      <section id="auth-panel"><div><h3 id="auth-title">Welcome back.</h3><p>Your username is how friends find you.</p><form id="auth-form"><label>Username<input name="username" autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" minlength="3" maxlength="20" required placeholder="island_operator"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="10" maxlength="72" required placeholder="At least 10 characters"></label><button class="mp-primary" id="auth-submit">SIGN IN ↗</button></form><button id="auth-switch" class="mp-text">New here? Create an account</button></div><aside><span>01 / FIND YOUR PEOPLE</span><h3>One island.<br>No teammates.</h3><p>2–8 players · Free-for-all<br>25 damage per shot · 3-second respawn<br>Highest elimination score wins.</p><small>Keyboard and mouse required.</small></aside></section>
      <section id="account-panel" hidden><div class="account-strip"><span id="account-name"></span><button id="logout" class="mp-text">SIGN OUT</button></div><div class="lobby-columns"><div><h3>Your groups</h3><form id="group-form" class="inline-form"><input name="name" minlength="2" maxlength="40" required placeholder="Name a new group" aria-label="New group name"><button class="mp-secondary">CREATE +</button></form><div id="groups-list"></div><h3 class="history-title">Recent matches</h3><div id="history-list" class="muted">No completed matches yet.</div></div><div id="group-detail"><div class="empty-lobby">◎<h3>A good match starts with a group.</h3><p>Create a group or accept an invitation to join.</p></div></div></div></section>
    </section>
    <div id="network-hud" hidden><div class="eyebrow">FREE-FOR-ALL / <span id="net-state">LOBBY</span></div><div id="scoreboard"></div><p id="net-message"></p><button id="net-lobby" class="mp-secondary">GROUP LOBBY · ESC</button></div>
  `);
  async function api(path, data) {
    const response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data) });
    let payload; try { payload = await response.json(); } catch { throw new Error('Backend unavailable. Start the Go server and PostgreSQL.'); }
    if (!response.ok) {
      if(response.status===401 && state.user && !['/login','/register'].includes(path)){disconnect();state.user=null;state.groups=[];state.selected=null;$('auth-panel').hidden=false;$('account-panel').hidden=true;}
      throw new Error(payload.error || 'Request failed');
    }
    return payload;
  }
  function notice(message, error = false) { $('lobby-notice').textContent = message; $('lobby-notice').classList.toggle('is-error', error); }
  async function action(fn) { if (busy) return; busy = true; try { await fn(); } catch (error) { notice(error.message, true); } finally { busy = false; } }
  function show() { state.visible = true; document.exitPointerLock?.(); $('lobby').hidden = false; refresh().catch(e=>notice(e.message,true)); }
  function hide() { state.visible = false; $('lobby').hidden = true; }
  function disconnect() { const ws = state.socket; state.socket = null; ws?.close(); state.connected = false; state.groupId = null; state.snapshot = null; $('network-hud').hidden = true; hooks.onExit(); }
  function connect(group) {
    if (state.connected && state.snapshot?.groupId === group.id) return;
    const old = state.socket; state.socket = null; old?.close(); state.connected = false; state.snapshot = null;
    state.groupId = group.id;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/groups/${group.id}/ws`); state.socket = ws;
    notice('Connecting to group…');
    ws.onopen = () => { if(state.socket!==ws)return;state.connected = true; notice('Connected. The group owner can start when 2–8 players are here.'); renderDetail(); };
    ws.onmessage = event => {
      if(state.socket!==ws)return;
      const snapshot = JSON.parse(event.data); if(snapshot.type!=='snapshot')return;
      const previous = state.snapshot; state.snapshot = snapshot;
      hooks.onSnapshot(snapshot, previous, state.user.id);
      renderScoreboard();
      if (!previous || previous.state !== snapshot.state || previous.players.map(p=>`${p.id}:${p.connected}`).join()!==snapshot.players.map(p=>`${p.id}:${p.connected}`).join()) renderDetail();
      if(snapshot.state==='running' && previous?.state!=='running') notice('Match is live! Click Deploy to enter. The clock runs for everyone.');
      if((snapshot.state==='finished'||snapshot.state==='saving') && previous?.state==='running') { show(); notice(snapshot.state==='saving'?'Time is up. Saving scores…':'Time is up. Final scores are below.'); }
      if(snapshot.state==='finished'&&previous?.state!=='finished') { notice('Match complete. Scores saved. The owner can start another round.'); loadHistory(); }
    };
    ws.onclose = () => { if(state.socket!==ws)return;state.connected=false;state.socket=null;hooks.onDisconnect();show();notice('Disconnected. Click Connect to rejoin. If a round is in progress, only its original players can reconnect.',true);renderDetail(); };
    ws.onerror = () => { if(state.socket===ws)notice('Could not connect. Check the server, accepted membership, and configured APP_ORIGIN.',true); };
  }
  function renderGroups() {
    $('groups-list').innerHTML = state.groups.length ? state.groups.map(g=>`<div class="group-card ${g.id===state.selected?'selected':''}"><button data-select="${g.id}"><b>${escape(g.name)}</b><small>${g.members.filter(m=>m.status==='accepted').length} members · ${g.status==='invited'?'INVITATION':g.ownerId===state.user.id?'YOU OWN THIS GROUP':'MEMBER'}</small></button>${g.status==='invited'?`<button class="mp-secondary" data-accept="${g.id}">ACCEPT</button>`:''}</div>`).join('') : '<p class="muted">No groups yet. Create one to invite friends.</p>';
  }
  function renderDetail() {
    const group = state.groups.find(g=>g.id===state.selected); if(!group) { $('group-detail').innerHTML='<div class="empty-lobby">◎<h3>Select or create a group.</h3></div>'; return; }
    const snap = state.snapshot?.groupId===group.id?state.snapshot:null;
    const connected = state.connected && state.groupId===group.id;
    const owner = (snap?.ownerId??group.ownerId)===state.user.id;
    const live = snap?.state==='running', saving=snap?.state==='saving';
    $('group-detail').innerHTML=`<div class="detail-heading"><div class="eyebrow">${live?'MATCH IN PROGRESS':'PRIVATE GROUP'}</div><h3>${escape(group.name)}</h3></div><div class="member-list">${group.members.map(m=>`<div><span>${escape(m.username)} ${m.id===group.ownerId?'<small>OWNER</small>':''}</span><small>${m.status==='invited'?'INVITED':snap?.players.some(p=>p.id===m.id&&p.connected)?'● CONNECTED':'OFFLINE'}</small></div>`).join('')}</div>
    ${group.status==='accepted'?`<div class="match-actions"><button id="connect-group" class="mp-secondary">${connected?'CONNECTED ✓':'CONNECT TO LOBBY'}</button>${live&&connected?'<button id="deploy" class="mp-primary">DEPLOY TO ISLAND ↗</button>':owner?`<button id="start-match" class="mp-primary" ${!connected||saving?'disabled':''}>${saving?'SAVING SCORES…':snap?.state==='finished'?'START ANOTHER ROUND ↗':'START 3-MINUTE MATCH ↗'}</button>`:'<p class="muted">The group owner starts the match.</p>'}</div>`:''}
    ${owner?'<div class="invite-section"><h4>Find a player</h4><form id="search-form" class="inline-form"><input id="username-query" name="q" minlength="2" maxlength="20" required placeholder="Search by username" aria-label="Search usernames"><button class="mp-secondary">SEARCH</button></form><div id="search-results"></div></div>':''}
    ${snap?.state==='finished'||saving?`<h4>Final scores</h4>${scoreRows(snap.players)}`:''}<button id="leave-group" class="mp-text">${group.status==='invited'?'DECLINE INVITATION':'LEAVE GROUP'}</button>`;
    $('connect-group')?.addEventListener('click',()=>connect(group));
    $('start-match')?.addEventListener('click',()=>action(async()=>{await api(`/groups/${group.id}/start`,{});}));
    $('deploy')?.addEventListener('click',()=>{hide();hooks.onEnter();});
    $('leave-group').onclick=()=>action(async()=>{await api(`/groups/${group.id}/leave`,{});if(state.snapshot?.groupId===group.id)disconnect();state.selected=null;await refresh();notice('Left the group.');});
    $('search-form')?.addEventListener('submit',e=>{e.preventDefault();const q=new FormData(e.target).get('q');const version=++searchVersion;action(async()=>{const users=await api(`/users?q=${encodeURIComponent(q)}`);if(version!==searchVersion||state.selected!==group.id||!$('search-results'))return;$('search-results').innerHTML=users.length?users.map(u=>`<div class="search-row"><span>${escape(u.username)}</span><button class="mp-secondary" data-invite="${escape(u.username)}">INVITE +</button></div>`).join(''):'<p class="muted">No usernames found.</p>';});});
  }
  function scoreRows(players) { return `<div class="score-table"><div><small>PLAYER</small><small>KILLS / DEATHS</small></div>${players.map((p,i)=>`<div class="${p.id===state.user.id?'self-score':''}"><span>${i+1}. ${escape(p.username)}${p.connected?'':' · offline'}</span><b>${p.kills} / ${p.deaths}</b></div>`).join('')}</div>`; }
  function renderScoreboard() { const snap=state.snapshot;if(!snap)return;$('network-hud').hidden=false;$('net-state').textContent=snap.state.toUpperCase();$('scoreboard').innerHTML=scoreRows(snap.players);const me=snap.players.find(p=>p.id===state.user.id);$('net-message').textContent=me?.health===0?`Respawning in ${Math.max(0,Math.ceil((me.respawnAt-snap.now)/1000))}s`:me?.protectedUntil>snap.now?'Spawn protection · shooting ends protection':snap.state==='running'?'1 elimination = 1 point':'Highest score wins · equal scores tie'; }
  async function loadHistory() { try {const matches=await api('/history');$('history-list').innerHTML=matches.length?matches.slice(0,5).map(m=>`<div class="history-row"><span>${escape(m.group)}</span><span>${m.kills} kills / ${m.deaths} deaths</span></div>`).join(''):'No completed matches yet.';}catch(e){notice(e.message,true);} }
  async function refresh() { if(polling)return;polling=true;try{if(!state.user){try{state.user=await api('/me');}catch(e){if(!e.message.includes('Sign in')&&!e.message.includes('Session expired'))notice(e.message,true);}}$('auth-panel').hidden=!!state.user;$('account-panel').hidden=!state.user;if(!state.user)return;$('account-name').textContent=`SIGNED IN AS ${state.user.username}`;const groups=await api('/groups');const changed=JSON.stringify(groups)!==JSON.stringify(state.groups);state.groups=groups;if(state.selected&&!groups.some(g=>g.id===state.selected))state.selected=null;if(changed){renderGroups();renderDetail();}await loadHistory();}finally{polling=false;} }
  $('auth-switch').onclick=()=>{authMode=authMode==='login'?'register':'login';$('auth-title').textContent=authMode==='login'?'Welcome back.':'Claim your username.';$('auth-submit').textContent=authMode==='login'?'SIGN IN ↗':'CREATE ACCOUNT ↗';$('auth-switch').textContent=authMode==='login'?'New here? Create an account':'Already have an account? Sign in';$('auth-form').elements.password.autocomplete=authMode==='login'?'current-password':'new-password';};
  $('auth-form').onsubmit=e=>{e.preventDefault();action(async()=>{const data=Object.fromEntries(new FormData(e.target));state.user=await api('/'+authMode,data);e.target.reset();notice(`Welcome, ${state.user.username}.`);await refresh();});};
  $('logout').onclick=()=>action(async()=>{await api('/logout',{});disconnect();state.user=null;state.groups=[];state.selected=null;$('auth-panel').hidden=false;$('account-panel').hidden=true;notice('Signed out.');});
  $('group-form').onsubmit=e=>{e.preventDefault();action(async()=>{const result=await api('/groups',Object.fromEntries(new FormData(e.target)));state.selected=result.id;e.target.reset();await refresh();connect(state.groups.find(g=>g.id===result.id));});};
  $('groups-list').onclick=e=>{const select=e.target.closest('[data-select]'),accept=e.target.closest('[data-accept]');if(select){state.selected=Number(select.dataset.select);renderGroups();renderDetail();}if(accept)action(async()=>{await api(`/groups/${accept.dataset.accept}/accept`,{});state.selected=Number(accept.dataset.accept);await refresh();notice('Invitation accepted. Connect to the lobby when ready.');});};
  $('group-detail').addEventListener('click',e=>{const button=e.target.closest('[data-invite]');if(button)action(async()=>{await api(`/groups/${state.selected}/invite`,{username:button.dataset.invite});await refresh();notice('Invitation sent. Your friend can accept it in their groups list.');});});
  $('multiplayer-open').onclick=show;$('net-lobby').onclick=show;
  $('lobby-close').onclick=()=>{hide();if(!state.connected)hooks.onExit();};
  setInterval(()=>{if(state.visible&&state.user)refresh().catch(e=>notice(e.message,true));},3000);
  return {state,show,send(message){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify(message));}};
}
