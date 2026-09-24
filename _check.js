


let PLAYERS=[], HISTORY=[], GAMES=[], META={};
let chart = null;

// ---- name helpers ----
const plainName = p => `${p.first_name} ${p.surname}`;
const nickName = p => p.nickname ? `${p.first_name} "${p.nickname}" ${p.surname}` : `${p.first_name} ${p.surname}`;
const primaryRating = p => p.std_rating ?? p.rapid_rating ?? p.blitz_rating ?? null;
// Optional rating suffix (e.g. an ECF rating status/increment) when present in the data.
// Older player records do not have one, so return an empty string rather than throwing.
const primaryRatingSuffix = p => {
  const suffix = p.std_rating_suffix ?? p.rapid_rating_suffix ?? p.blitz_rating_suffix ?? p.rating_suffix ?? '';
  return suffix == null ? '' : String(suffix);
};

function allTeamNames(){
  const s = new Set();
  PLAYERS.forEach(p => (p.teams||[]).forEach(t => s.add(t.team_name)));
  return [...s].sort();
}
function teamsFor(p){ return (p.teams||[]).map(t=>t.team_name); }
function captainsForTeam(team){ return PLAYERS.filter(p => (p.teams||[]).some(t => t.team_name===team && t.role==='captain')); }
function isCaptain(p, team){ return (p.teams||[]).some(t => t.team_name===team && t.role==='captain'); }
function playersForTeam(team){ return PLAYERS.filter(p => (p.teams||[]).some(t => t.team_name===team)); }

function seasonOf(monthStr){ // 'YYYY-MM-01'
  const d = new Date(monthStr+'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth()+1;
  const startYear = m>=9 ? y : y-1;
  return `${String(startYear%100).padStart(2,'0')}/${String((startYear+1)%100).padStart(2,'0')}`;
}
function allSeasons(){
  const s = new Set(HISTORY.map(h=>seasonOf(h.month)));
  return [...s].sort();
}

async function loadData(){
  const loadState = document.getElementById('loadState');
  try{
    const [players, hist, games, meta] = await Promise.all([
      fetch('data/players.json').then(r=>r.ok?r.json():Promise.reject(r.status)),
      fetch('data/rating_history.json').then(r=>r.ok?r.json():Promise.reject(r.status)),
      fetch('data/games.json').then(r=>r.ok?r.json():[]).catch(()=>[]),
      fetch('data/meta.json').then(r=>r.ok?r.json():{}).catch(()=>({})),
    ]);
    PLAYERS=players; HISTORY=hist; GAMES=games; META=meta;
    loadState.style.display='none';
    if(META.last_updated) document.getElementById('updated').textContent = 'Last updated: '+new Date(META.last_updated).toLocaleString('en-GB');
    if(META.warnings && META.warnings.length){
      document.getElementById('footerNote').innerHTML = `${META.warnings.length} data warning(s) from the last scrape run — see <code>data/meta.json</code> for details.`;
    }
    initProgression();
    initSquad();
  }catch(err){
    loadState.textContent = 'Could not load data/players.json, data/rating_history.json or data/games.json. If you opened this file directly, run it via a local server or GitHub Pages — browsers block fetch() on file:// URLs.';
    loadState.className = 'error';
    console.error(err);
  }
}

document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-'+t.dataset.panel).classList.add('active');
    if(t.dataset.panel==='progression' && chart) chart.resize();
  });
});

/* =================== PROGRESSION =================== */

function initProgression(){
  const teamSel = document.getElementById('pTeam');
  allTeamNames().forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; teamSel.appendChild(o); });

  const seasonSel = document.getElementById('pSeason');
  allSeasons().forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; seasonSel.appendChild(o); });

  teamSel.addEventListener('change', ()=>{ populatePlayerFilter(); renderProgression(); });
  document.getElementById('pPlayer').addEventListener('change', renderProgression);
  document.getElementById('pDomain').addEventListener('change', renderProgression);
  document.getElementById('pSeason').addEventListener('change', renderProgression);

  populatePlayerFilter();
  renderSummaryCards();
  renderProgression();
}

function populatePlayerFilter(){
  const team = document.getElementById('pTeam').value;
  const playerSel = document.getElementById('pPlayer');
  playerSel.innerHTML = '<option value="">All players (compare)</option>';
  const pool = team ? playersForTeam(team) : PLAYERS;
  pool.slice().sort((a,b)=>plainName(a).localeCompare(plainName(b))).forEach(p=>{
    const o=document.createElement('option'); o.value=p.ecf_code; o.textContent=plainName(p); playerSel.appendChild(o);
  });
}

function renderSummaryCards(){
  const withRating = PLAYERS.filter(p=>primaryRating(p)!=null).length;
  const cards = [
    [PLAYERS.length, 'players tracked'],
    [allTeamNames().length, 'teams'],
    [withRating, 'with a current rating'],
    [new Set(HISTORY.map(h=>h.ecf_code)).size, 'with rating history'],
  ];
  document.getElementById('progSummary').innerHTML = cards.map(([n,l])=>`<div class="card"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
}

function gamesFor(ecfCode, domain, month){
  // games recorded in the same calendar month as this rating point
  return GAMES.filter(g => g.ecf_code===ecfCode && g.domain===domain && g.date && g.date.slice(0,7)===month.slice(0,7));
}

function renderProgression(){
  const team = document.getElementById('pTeam').value;
  const playerCode = document.getElementById('pPlayer').value;
  const domain = document.getElementById('pDomain').value;
  const season = document.getElementById('pSeason').value;

  let candidates = playerCode ? PLAYERS.filter(p=>p.ecf_code===playerCode) : (team ? playersForTeam(team) : PLAYERS);
  const codes = new Set(candidates.map(p=>p.ecf_code));

  let rows = HISTORY.filter(h => codes.has(h.ecf_code) && h.domain===domain);
  if(season) rows = rows.filter(h => seasonOf(h.month)===season);

  const months = [...new Set(rows.map(r=>r.month))].sort();
  const byPlayer = {};
  rows.forEach(r=>{ (byPlayer[r.ecf_code] = byPlayer[r.ecf_code]||{})[r.month] = r.rating; });

  const palette = ['#C9A24B','#5c8a63','#a85c4f','#6f9bd1','#c98ac9','#d1a45c','#8ab6a0','#c9705c'];
  const datasets = Object.keys(byPlayer).map((code,i)=>{
    const p = PLAYERS.find(x=>x.ecf_code===code);
    return {
      label: p ? plainName(p) : code,
      data: months.map(m => byPlayer[code][m] ?? null),
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      spanGaps: true,
      tension: 0.15,
      pointRadius: 3,
      pointHoverRadius: 6,
    };
  });

  const ctx = document.getElementById('ratingChart').getContext('2d');
  if(chart) chart.destroy();

  if(months.length === 0 || datasets.length === 0){
    document.getElementById('ratingChart').style.display='none';
    let msg = document.getElementById('noDataMsg');
    if(!msg){ msg = document.createElement('div'); msg.id='noDataMsg'; msg.className='empty'; document.querySelector('.chart-wrap').appendChild(msg); }
    msg.textContent = 'No rating history for this selection yet.';
    renderStatCards(candidates, domain, season, rows);
    return;
  }
  document.getElementById('ratingChart').style.display='block';
  const existingMsg = document.getElementById('noDataMsg'); if(existingMsg) existingMsg.remove();

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: months.map(m => new Date(m+'T00:00:00').toLocaleDateString('en-GB',{month:'short',year:'2-digit'})), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: '#c9c2ab', font: { family:'IBM Plex Mono', size:11 } } },
        tooltip: {
          backgroundColor: '#0d2a1b', borderColor:'#C9A24B', borderWidth:1, titleColor:'#C9A24B', bodyColor:'#F1ECDF',
          callbacks: {
            afterBody: (items) => {
              const item = items[0]; if(!item) return [];
              const code = Object.keys(byPlayer)[item.datasetIndex];
              const month = months[item.dataIndex];
              const gs = gamesFor(code, domain, month);
              if(gs.length===0) return [];
              const icon = r => r==='W' ? '🟢 W' : r==='L' ? '🔴 L' : r==='D' ? '🟡 D' : r;
              return ['', 'Games this month:'].concat(gs.map(g => {
                const d = g.date ? new Date(g.date+'T00:00:00').toLocaleDateString('en-GB') : '?';
                return `  ${icon(g.result)}  ${d}  vs ${g.opponent_name||'?'} (${g.opponent_rating??'?'})  — you: ${g.player_rating??'?'}`;
              }));
            }
          }
        }
      },
      scales: {
        x: { ticks:{ color:'#c9c2ab', font:{family:'IBM Plex Mono', size:10} }, grid:{ color:'#2a4c39' } },
        y: { ticks:{ color:'#c9c2ab', font:{family:'IBM Plex Mono', size:10} }, grid:{ color:'#2a4c39' } },
      }
    }
  });
  renderStatCards(candidates, domain, season, rows);
}

function renderStatCards(candidates, domain, season, historyRows){
  const codes = candidates.map(p=>p.ecf_code);
  let gs = GAMES.filter(g => codes.includes(g.ecf_code) && g.domain===domain && ['W','L','D'].includes(g.result));
  if(season) gs = gs.filter(g => seasonOf(g.date) === season);
  const cards = [];

  // Hot Streak -- longest run of consecutive wins in the selected period
  let hs = {code:null, streak:0};
  codes.forEach(code=>{
    let cur=0, best=0;
    gs.filter(g=>g.ecf_code===code).sort((a,b)=>a.date.localeCompare(b.date))
      .forEach(g=>{ if(g.result==='W'){cur++; best=Math.max(best,cur);} else cur=0; });
    if(best>hs.streak) hs={code, streak:best};
  });
  if(hs.streak>=2){
    const p=PLAYERS.find(x=>x.ecf_code===hs.code);
    cards.push({t:'🔥 Hot Streak', n:p?plainName(p):hs.code, d:`${hs.streak}-game winning run`});
  }

  // Most Improved -- rating change across the period, from the history data
  const byHist = {};
  historyRows.forEach(r=>(byHist[r.ecf_code]=byHist[r.ecf_code]||[]).push(r));
  let mi = {code:null, delta:-Infinity};
  Object.entries(byHist).forEach(([code,rs])=>{
    rs.sort((a,b)=>a.month.localeCompare(b.month));
    if(rs.length<2) return;
    const delta = rs[rs.length-1].rating - rs[0].rating;
    if(delta>mi.delta) mi={code, delta, from:rs[0].rating, to:rs[rs.length-1].rating};
  });
  if(mi.code){
    const p=PLAYERS.find(x=>x.ecf_code===mi.code);
    cards.push({t:'📈 Most Improved', n:p?plainName(p):mi.code, d:`${mi.delta>=0?'+':''}${mi.delta} (${mi.from} → ${mi.to})`});
  }

  // Biggest Upset -- win with the largest opponent-rating margin
  let bu=null;
  gs.filter(g=>g.result==='W' && g.opponent_rating!=null && g.player_rating!=null).forEach(g=>{
    const margin = g.opponent_rating - g.player_rating;
    if(!bu || margin>bu.margin) bu={...g, margin};
  });
  if(bu){
    const p=PLAYERS.find(x=>x.ecf_code===bu.ecf_code);
    cards.push({t:'⚡ Biggest Upset', n:p?plainName(p):bu.ecf_code, d:`beat ${bu.opponent_name} (${bu.opponent_rating}), rated +${bu.margin} above you (${bu.player_rating})`});
  }

  // Most Active -- most games played in the period
  const counts={}; gs.forEach(g=>counts[g.ecf_code]=(counts[g.ecf_code]||0)+1);
  const ma = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  if(ma){
    const p=PLAYERS.find(x=>x.ecf_code===ma[0]);
    cards.push({t:'♟️ Most Active', n:p?plainName(p):ma[0], d:`${ma[1]} games played`});
  }

  // Best Score Rate -- min 3 games, to avoid a 1-game 100% skewing it
  let bs=null;
  codes.forEach(code=>{
    const pg = gs.filter(g=>g.ecf_code===code); if(pg.length<3) return;
    const pts = pg.reduce((a,g)=>a+(g.result==='W'?1:g.result==='D'?0.5:0),0);
    const pct = pts/pg.length*100;
    if(!bs || pct>bs.pct) bs={code, pct, games:pg.length};
  });
  if(bs){
    const p=PLAYERS.find(x=>x.ecf_code===bs.code);
    cards.push({t:'🏆 Best Score Rate', n:p?plainName(p):bs.code, d:`${bs.pct.toFixed(0)}% from ${bs.games} games`});
  }

  document.getElementById('statCards').innerHTML = cards.length
    ? cards.map(c=>`<div class="stat-card"><div class="stat-title">${c.t}</div><div class="stat-name">${c.n}</div><div class="stat-detail">${c.d}</div></div>`).join('')
    : `<div class="empty">Not enough game data for stat cards yet.</div>`;
}

/* =================== SQUAD BUILDER =================== */

let squad = []; // array of ecf_code, in board order
let currentTeam = '';

function initSquad(){
  const sel = document.getElementById('sTeam');
  allTeamNames().forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
  sel.addEventListener('change', ()=>{ currentTeam = sel.value; squad=[]; renderSquad(); });
  document.getElementById('sOpp').addEventListener('input', renderSheet);
  document.getElementById('sDate').addEventListener('input', renderSheet);
  document.getElementById('copyBtn').addEventListener('click', copyText);
  document.getElementById('imgBtn').addEventListener('click', downloadImage);
  renderSquad();
}

function renderSquad(){
  const banner = document.getElementById('captainBanner');
  if(!currentTeam){
    banner.style.display='none';
    document.getElementById('poolList').innerHTML='';
    document.getElementById('squadList').innerHTML='';
    document.getElementById('squadTotals').innerHTML='';
    renderSheet();
    return;
  }
  const caps = captainsForTeam(currentTeam);
  banner.style.display='block';
  banner.innerHTML = caps.length
    ? `<b>${currentTeam}</b> — Captain${caps.length>1?'s':''}: ${caps.map(plainName).join(', ')}`
    : `<b>${currentTeam}</b> — no captain recorded in the fact table.`;

  const pool = playersForTeam(currentTeam).filter(p=>!squad.includes(p.ecf_code))
    .sort((a,b)=>nickName(a).localeCompare(nickName(b)));
  const poolEl = document.getElementById('poolList');
  poolEl.innerHTML = pool.length ? pool.map(p=>{
    const r = primaryRating(p);
    return `<div class="player-row" data-code="${p.ecf_code}"><span>${nickName(p)}${isCaptain(p,currentTeam)?' <span class="cap">(C)</span>':''}</span><span class="rtg">${r ?? '—'}</span></div>`;
  }).join('') : `<div class="empty">No more eligible players to add.</div>`;
  poolEl.querySelectorAll('.player-row').forEach(el=>el.addEventListener('click', ()=>{ squad.push(el.dataset.code); renderSquad(); }));

  const squadEl = document.getElementById('squadList');
  document.getElementById('squadCount').textContent = squad.length ? `(${squad.length})` : '';
  squadEl.innerHTML = squad.map((code,i)=>{
    const p = PLAYERS.find(x=>x.ecf_code===code);
    const r = p?primaryRating(p):null;
    const suf = p?primaryRatingSuffix(p):null;
    return `<div class="squad-row" draggable="true" data-code="${code}">
      <span class="handle">⠿</span>
      <span class="num">${i+1}</span>
      <span class="sq-name">${p?nickName(p):code}${p&&isCaptain(p,currentTeam)?' <span class="cap">(C)</span>':''}</span>
      <span class="rtg-col">${r!=null ? r+(suf||'') : '—'}</span>
      <span class="btns">
        <button data-act="up" ${i===0?'disabled':''}>↑</button>
        <button data-act="down" ${i===squad.length-1?'disabled':''}>↓</button>
        <button data-act="remove">✕</button>
      </span>
    </div>`;
  }).join('') || `<div class="empty">Click players on the left to add them.</div>`;

  attachDragHandlers(squadEl);
  squadEl.querySelectorAll('.squad-row button').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const row = btn.closest('.squad-row');
      const idx = squad.indexOf(row.dataset.code);
      if(btn.dataset.act==='remove') squad.splice(idx,1);
      if(btn.dataset.act==='up' && idx>0) [squad[idx-1],squad[idx]]=[squad[idx],squad[idx-1]];
      if(btn.dataset.act==='down' && idx<squad.length-1) [squad[idx+1],squad[idx]]=[squad[idx],squad[idx+1]];
      renderSquad();
    });
  });

  renderTotals();
  renderSheet();
}

function renderTotals(){
  const ratings = squad.map(code=>{ const p=PLAYERS.find(x=>x.ecf_code===code); return p?primaryRating(p):null; }).filter(r=>r!=null);
  const sum = ratings.reduce((a,b)=>a+b,0);
  const avg = ratings.length ? Math.round(sum/ratings.length) : 0;
  const el = document.getElementById('squadTotals');
  if(squad.length===0){ el.innerHTML=''; return; }
  const missing = squad.length - ratings.length;
  el.innerHTML = `
    <div><b>${sum}</b>Sum rating</div>
    <div><b>${avg}</b>Average rating</div>
    ${missing ? `<div style="align-self:center; font-size:11px;">${missing} player(s) have no rating on file</div>` : ''}`;
}

let dragSrcIdx = null;
function attachDragHandlers(container){
  container.querySelectorAll('.squad-row').forEach((row, idx)=>{
    row.addEventListener('dragstart', ()=>{ dragSrcIdx = idx; row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
    row.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      const targetIdx = idx;
      if(dragSrcIdx===null || dragSrcIdx===targetIdx) return;
      const [moved] = squad.splice(dragSrcIdx,1);
      squad.splice(targetIdx,0,moved);
      dragSrcIdx=null;
      renderSquad();
    });
  });
}

function sheetMetaParts(){
  const opp = document.getElementById('sOpp').value.trim();
  const date = document.getElementById('sDate').value;
  const dateFmt = date ? new Date(date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
  return [opp?`vs ${opp}`:null, dateFmt||null].filter(Boolean);
}

function renderSheet(){
  const sheet = document.getElementById('sheet');
  if(!currentTeam || squad.length===0){
    sheet.innerHTML='';
    document.getElementById('copyBtn').disabled=true;
    document.getElementById('imgBtn').disabled=true;
    return;
  }
  document.getElementById('copyBtn').disabled=false;
  document.getElementById('imgBtn').disabled=false;

  const ratings = squad.map(code=>{ const p=PLAYERS.find(x=>x.ecf_code===code); return p?primaryRating(p):null; }).filter(r=>r!=null);
  const sum = ratings.reduce((a,b)=>a+b,0);
  const avg = ratings.length ? Math.round(sum/ratings.length) : 0;

  const items = squad.map((code,i)=>{
    const p = PLAYERS.find(x=>x.ecf_code===code);
    const cap = p && isCaptain(p, currentTeam);
    const r = p?primaryRating(p):null, suf = p?primaryRatingSuffix(p):null;
    const ratingStr = r!=null ? `${r}${suf||''}` : '—';
    return `<li><span>Bd ${i+1}: ${p?nickName(p):code}${cap?' <span class="capTag">(C)</span>':''}</span><span class="sheetRtg">${ratingStr}</span></li>`;
  }).join('');

  const meta = sheetMetaParts();
  sheet.innerHTML = `
    <div class="sheetTitle">${currentTeam}</div>
    <div class="sheetMeta">${meta.length?meta.join(' — '):'Squad'}</div>
    <ol>${items}</ol>
    <div class="sheetTotals"><div><b style="color:var(--gold)">${sum}</b> sum</div><div><b style="color:var(--gold)">${avg}</b> average</div></div>`;
}

function copyText(){
  const ratings = squad.map(code=>{ const p=PLAYERS.find(x=>x.ecf_code===code); return p?primaryRating(p):null; }).filter(r=>r!=null);
  const sum = ratings.reduce((a,b)=>a+b,0);
  const avg = ratings.length ? Math.round(sum/ratings.length) : 0;
  const lines = [currentTeam];
  const meta = sheetMetaParts();
  if(meta.length) lines.push(meta.join(' — '));
  lines.push('');
  const nameWidth = Math.max(...squad.map(code=>{
    const p=PLAYERS.find(x=>x.ecf_code===code); return (p?nickName(p):code).length;
  })) + 5;
  squad.forEach((code,i)=>{
    const p = PLAYERS.find(x=>x.ecf_code===code);
    const cap = p && isCaptain(p, currentTeam);
    const name = `${i+1}. ${p?nickName(p):code}${cap?' (C)':''}`;
    const r = p?primaryRating(p):null, suf = p?primaryRatingSuffix(p):null;
    const ratingStr = r!=null ? `${r}${suf||''}` : '—';
    lines.push(name.padEnd(nameWidth) + ratingStr.padStart(6));
  });
  lines.push('');
  lines.push(`Sum rating: ${sum}  |  Average rating: ${avg}`);
  navigator.clipboard.writeText(lines.join('\n')).then(()=>{
    const msg = document.getElementById('copiedMsg');
    msg.style.display='inline';
    setTimeout(()=>msg.style.display='none', 1800);
  }).catch(()=>alert(lines.join('\n')));
}

function downloadImage(){
  const sheet = document.getElementById('sheet');
  html2canvas(sheet, {backgroundColor:'#0d2a1b', scale:2}).then(canvas=>{
    const link = document.createElement('a');
    const safe = currentTeam.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    link.download = `${safe}-squad.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

loadData();
