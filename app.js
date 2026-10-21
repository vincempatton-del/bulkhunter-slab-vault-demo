import {categories as baseCategories, tiers as baseTiers, cards as referenceCards, rarities} from './lib/data.js';
import {formatMoney} from './lib/engine.js';
import {request, browserDemo, resetDemo} from './lib/transport.js';

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let categories=baseCategories;
let tiers=baseTiers;
let cards=[];
let packConfigs=[];
let catalogReady=false;
let openingBusy=false;
let pendingOpening=null;
let collectionRevision=0;
let categoryId = 'tcg';
let tierId = 'starter';
let poolMode = 'chases';
let activePull = null;
let revealTimer;
let toastTimer;
let collection = [];
let sourcePhotos = [];

function getCategory(id){return categories.find(item=>item.id===id)||baseCategories[0];}
function getTier(id){const tier=tiers.find(item=>item.id===id)||baseTiers[0];const config=packConfigs.find(item=>item.categoryId===categoryId&&item.tierId===id);return {...tier,...(config?{odds:config.odds,enabled:config.enabled}: {})};}
function getPool({categoryId:category,tierId:tier}){return cards.filter(card=>card.category===category&&card.tierId===tier);}
async function api(path,options={}) {
  const response=await request(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error?.message||result.message||'The vault could not complete this request.'),{status:response.status,code:result.error?.code});
  return result;
}
async function refreshCatalog(){const result=await api('api/catalog');categories=result.categories;tiers=result.tiers;cards=result.inventory;packConfigs=result.packConfigs;catalogReady=true;renderCategories();renderTiers();renderPool();}
async function refreshCollection(){const revision=++collectionRevision;const result=await api('api/collection');if(revision!==collectionRevision)return;collection=result.pulls;renderCollection();}
function packAvailability(){const pack=packConfigs.find(item=>item.categoryId===categoryId&&item.tierId===tierId);return pack&&pack.enabled&&Object.entries(pack.odds).every(([rarity,weight])=>weight===0||pack.availability[rarity]>0);}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4500);
}

function thumbnail(category) {
  return cards.find(card => card.category === category)?.image || referenceCards.find(card=>card.category===category)?.image || 'assets/favicon.svg';
}

function renderCategories() {
  const subtitles = {tcg:'ICONIC HITS & MODERN FAVORITES',sports:'ROOKIES, STARS & BIG MOMENTS',classics:'OLD SCHOOL. ALL-TIME FAVORITES.'};
  $('category-list').innerHTML = categories.map(category => `<button class="category-choice ${category.id === categoryId ? 'selected' : ''}" aria-pressed="${category.id === categoryId}" data-category="${category.id}"><img class="category-thumb" src="${escapeHtml(thumbnail(category.id))}" alt="" width="44" height="45"><div><strong>${escapeHtml(category.label)}</strong><small>${subtitles[category.id]}</small></div><span class="choice-dot" aria-hidden="true"></span></button>`).join('');
}

function renderTiers() {
  const tier = getTier(tierId);
  $('selected-category-label').textContent = getCategory(categoryId).label;
  $('tier-list').innerHTML = tiers.map(item => `<button class="tier-choice ${item.id === tierId ? 'selected' : ''}" aria-pressed="${item.id === tierId}" data-tier="${item.id}"><strong>${item.name}</strong><span>${formatMoney(item.price)}</span></button>`).join('');
  $('value-range').textContent = `${formatMoney(tier.floor)} – ${formatMoney(tier.ceiling)}`;
  $('odds-list').innerHTML = rarities.map(rarity => `<div class="odds-item" style="--rarity:${rarity.color}"><span><i></i>${rarity.label}</span><strong>${tier.odds[rarity.id]}%</strong></div>`).join('');
  $('pack-tier-name').textContent = tier.name.toUpperCase();
  $('stage-code').textContent = `SERIES 001 / ${getCategory(categoryId).label.toUpperCase()}`;
  $('hero-pack').style.filter = tierId === 'silver' ? 'saturate(.3)' : '';
  $('hero-pack').style.setProperty('--tier-accent',tier.color);
  const pack=packConfigs.find(item=>item.categoryId===categoryId&&item.tierId===tierId);
  const available=packAvailability();
  $('open-button').disabled=openingBusy||(!pendingOpening&&(!catalogReady||!available));
  $('open-button').innerHTML=`${openingBusy?'SECURING YOUR SLAB…':pendingOpening?'RETRY LAST OPENING':!catalogReady?'CONNECTING TO VAULT…':!available?'WAITING FOR A RESTOCK':'OPEN A DEMO PACK'} <span>↗</span>`;
  if($('stock-counter'))$('stock-counter').textContent=!catalogReady?(browserDemo?'Loading your personal demo vault':'Connecting to shared inventory'):available?`${pack.availability.total} unique demo slabs available${browserDemo?' in this browser':''}`:'This pack is waiting for a restock.';
  if($('vault-count'))$('vault-count').textContent=cards.length;
}

function rarityFor(card) { return rarities.find(rarity => rarity.id === card.rarity); }

function cardMarkup(card, openedAt) {
  const rarity = rarityFor(card);
  const tag = openedAt ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(openedAt)) : rarity.label;
  return `<button class="slab-card" data-card="${card.id}" aria-label="View ${escapeHtml(card.name)}, ${card.grader} ${card.grade}, sample value ${formatMoney(card.value)}"><div class="card-art"><span class="rarity-badge" style="--rarity:${rarity.color}">${escapeHtml(tag)}</span><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.year + ' ' + card.name + ' in its ' + card.grader + ' graded slab')}" width="180" height="300" loading="lazy"></div><div class="card-details"><span class="card-set">${card.year} · ${escapeHtml(card.set)}</span><h3>${escapeHtml(card.name)}</h3><div class="card-meta"><span class="grade-badge">${card.grader} ${card.grade}</span><strong>${formatMoney(card.value)}<small>SAMPLE VALUE</small></strong></div></div></button>`;
}

function renderPool() {
  let pool;
  if (poolMode === 'all') {
    pool = getPool({categoryId,tierId});
    $('pool-description').textContent = `All ${pool.length} demo outcomes in the ${getTier(tierId).name} ${getCategory(categoryId).label} pack.`;
  } else {
    const unique = new Set();
    pool = cards.filter(card => card.category === categoryId).sort((a,b) => b.value-a.value).filter(card => {
      if (unique.has(card.sourceId||card.id)) return false;
      unique.add(card.sourceId||card.id);
      return true;
    }).slice(0,3);
    $('pool-description').textContent = 'A few sample chases across pack levels. Select a level to see its exact pool.';
  }
  $('card-grid').innerHTML = pool.length ? pool.map(card => cardMarkup(card)).join('') : '<div class="pool-empty"><span>◇</span><p>The vault is getting a refresh.</p><small>Come back for the next drop.</small></div>';
  $('tab-chases').setAttribute('aria-selected',String(poolMode === 'chases'));
  $('tab-all').setAttribute('aria-selected',String(poolMode === 'all'));
}

function showStep(step) {
  $('category-step').hidden = step !== 'category';
  $('tier-step').hidden = step !== 'tier';
  $('step-indicator').textContent = step === 'category' ? '01 / 02' : '02 / 02';
  if (step === 'tier') renderTiers();
}

function renderCollection() {
  const query = $('collection-search').value.trim().toLocaleLowerCase();
  const sort = $('collection-sort').value;
  const all = collection.filter(pull=>pull.card);
  const filtered = all.filter(({card}) => `${card.name} ${card.set} ${getCategory(card.category).label} ${getTier(card.tierId).name}`.toLocaleLowerCase().includes(query));
  filtered.sort((a,b) => sort === 'value' ? b.card.value-a.card.value || b.openedAt.localeCompare(a.openedAt) : sort === 'name' ? a.card.name.localeCompare(b.card.name) : b.openedAt.localeCompare(a.openedAt));
  $('collection-grid').innerHTML = filtered.map(({card,openedAt}) => cardMarkup(card,openedAt)).join('');
  $('collection-total').textContent = all.length;
  $('collection-value').textContent = formatMoney(all.reduce((total,{card}) => total+card.value,0));
  $('collection-rare').textContent = all.filter(({card}) => card.rarity !== 'common').length;
  $('collection-empty').hidden = filtered.length > 0;
  if (!filtered.length) {
    $('collection-empty').querySelector('h2').textContent = query ? 'NO MATCHES THIS TIME.' : 'YOUR FIRST PULL IS WAITING.';
    $('collection-empty').querySelector('p').textContent = query ? 'Try a different card name, set, category, or pack level.' : 'Open a demo pack and start your collection.';
    $('collection-empty').querySelector('a').hidden = Boolean(query);
  }
  $('export-button').disabled = !all.length;
  $('nav-count').textContent = all.length;
}

function route() {
  const isCollection = location.hash === '#collection';
  $('shop-view').hidden = isCollection;
  $('collection-view').hidden = !isCollection;
  document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active',link.dataset.nav === (isCollection ? 'collection' : 'packs')));
  if (isCollection) { renderCollection(); window.scrollTo({top:0,behavior:'instant'}); }
  else if (location.hash === '#how-it-works') $('how-it-works').scrollIntoView();
  else window.scrollTo({top:0,behavior:'instant'});
}

async function startPack() {
  if(openingBusy)return;
  if ($('reveal-dialog').open && activePull && !activePull.saved) return;
  clearTimeout(revealTimer);
  if(!pendingOpening&&!packAvailability()){toast('This pack is waiting for a restock. Try another level.');return;}
  openingBusy=true;renderTiers();
  try {
    pendingOpening ||= {categoryId,tierId,requestId:crypto.randomUUID(),expectedOdds:{...getTier(tierId).odds}};
    const result=await api('api/draw',{method:'POST',body:JSON.stringify(pendingOpening)});
    const card = result.card;
    activePull = {card, saved:false, revealing:false,allocated:true};
    collectionRevision++;
    if(!collection.some(pull=>pull.pullId===result.pullId))collection.push({pullId:result.pullId,cardId:card.id,openedAt:result.openedAt,card});
    pendingOpening=null;
    $('reveal-dialog').classList.remove('opening');
    $('reveal-dialog').classList.remove('has-grail','has-rare');
    $('reveal-eyebrow').textContent = `${getCategory(card.category).label.toUpperCase()} / ${getTier(card.tierId).name.toUpperCase()}`;
    $('reveal-heading').textContent = 'READY TO REVEAL?';
    $('reveal-subtitle').textContent = 'One pack. One surprise. Let’s see what’s inside.';
    $('reveal-pack-button').hidden = false;
    $('reveal-pack-button').disabled = false;
    $('reveal-pack-button').querySelector('.reveal-pack-level').textContent = getTier(card.tierId).name.toUpperCase();
    $('revealed-card').hidden = true;
    $('result-copy').hidden = true;
    $('reveal-actions').hidden = true;
    $('instant-reveal').hidden = false;
    if (!$('reveal-dialog').open) $('reveal-dialog').showModal();
    $('reveal-pack-button').focus();
    renderCollection();
    await refreshCatalog();
  } catch(error) {
    if(error.status && error.status<500)pendingOpening=null;
    toast(error.message||'Connection interrupted. Retry the same opening to recover your slab safely.');
    try{await refreshCatalog();}catch{}
  } finally {openingBusy=false;renderTiers();}
}

function revealCard(instant = false) {
  if (!activePull || activePull.saved || activePull.revealing) return;
  activePull.revealing = true;
  $('reveal-pack-button').disabled = true;
  $('instant-reveal').hidden = true;
  $('reveal-dialog').classList.add('opening');
  const finish = () => {
    if (!activePull || activePull.saved) return;
    const card = activePull.card;
    activePull.saved = true;
    $('reveal-pack-button').hidden = true;
    $('reveal-dialog').classList.remove('opening');
    const rarity = rarityFor(card);
    $('reveal-dialog').classList.toggle('has-grail',card.rarity==='legendary');
    $('reveal-dialog').classList.toggle('has-rare',card.rarity==='rare');
    $('reveal-eyebrow').textContent = `${rarity.label.toUpperCase()} / ${getTier(card.tierId).name.toUpperCase()} PACK`;
    $('reveal-heading').textContent = card.rarity === 'legendary' ? 'THAT’S A GRAIL.' : card.rarity === 'rare' ? 'WHAT A PULL.' : 'MEET YOUR NEXT SLAB.';
    $('reveal-subtitle').textContent = 'A new chapter in your collection.';
    $('revealed-card').innerHTML = `<div class="result-slab"><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)} graded ${card.grader} ${card.grade}" width="220" height="330"></div>`;
    $('revealed-card').hidden = false;
    $('result-copy').innerHTML = `<h3>${escapeHtml(card.name)}</h3><p>${card.year} · ${escapeHtml(card.set)} · ${card.grader} ${card.grade}</p><p class="result-value">${formatMoney(card.value)} <span>ILLUSTRATIVE VALUE</span></p><p class="saved-status">✓ Saved to your collection · This slab is now off the shelf</p>`;
    $('result-copy').hidden = false;
    $('reveal-actions').hidden = false;
    renderCollection();
    $('open-again').focus();
  };
  if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else revealTimer = setTimeout(finish,800);
}

function closeReveal() {
  // Finish a reveal already in progress so closing the animation cannot discard a draw.
  if (activePull?.allocated && !activePull.saved) {
    clearTimeout(revealTimer);
    activePull.revealing = false;
    revealCard(true);
  }
  $('reveal-dialog').close();
}

function info(title, content, {button='GOT IT', onClick, cancel=false} = {}) {
  $('info-title').textContent = title;
  $('info-content').innerHTML = content;
  $('info-done').innerHTML = `${escapeHtml(button)} <span>→</span>`;
  $('info-cancel').hidden = !cancel;
  $('info-done').onclick = async () => {
    $('info-done').disabled = true;
    $('info-cancel').disabled = true;
    $('close-info').disabled = true;
    try { if (onClick) await onClick(); $('info-dialog').close(); }
    catch (error) { toast(error.message || 'The demo could not be reset. Please try again.'); }
    finally { $('info-done').disabled = false; $('info-cancel').disabled = false; $('close-info').disabled = false; }
  };
  $('info-dialog').showModal();
}

function showCard(cardId) {
  const card = cards.find(item => item.id === cardId)||collection.find(pull=>pull.cardId===cardId)?.card;
  if (!card) return;
  const tier = getTier(card.tierId);
  const source = sourcePhotos.find(photo => photo.id === card.sourceId);
  info(card.name.toUpperCase(), `<img class="detail-photo" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)} slab"><p><strong>${card.year} · ${escapeHtml(card.set)}</strong><br>${card.grader} ${card.grade} · ${getCategory(card.category).label}</p><p>Sample value: <strong>${formatMoney(card.value)}</strong><br>${tier.name} pack · ${rarityFor(card).label} · ${tier.odds[card.rarity]}% reveal odds.</p><p>One real slab photo represents a demo outcome. Pack prices and assigned values are illustrative; this card is not being offered for sale.</p>${source ? `<p><a href="${escapeHtml(source.sourcePage)}" target="_blank" rel="noopener noreferrer">Temporary photo source ↗</a></p>` : ''}`);
}

function showDemoInfo() {
  const storage = browserDemo
    ? '<p><strong>This is your personal browser sandbox.</strong> Your sample inventory, collection, uploaded photos, and manager changes are saved in this browser. Every visitor gets a separate sample vault. There is no sign-in, shared real stock, or shared inventory server in this version.</p><p>Try the Vault Manager to add samples or change prices and odds. Use <strong>Reset my demo</strong> to restore the original sample vault and clear your local changes. Export your collection first if you want to keep a copy. Clearing this site’s browser data also clears the demo.</p>'
    : '<p>Every draw is recorded on the shared server. The admin can restock, hide slabs, and adjust future odds; the current odds are always shown before you open. An unavailable rarity is never silently replaced by a different one.</p><p>Your browser has its own collection. Use Export to keep a copy. Clearing its cookies or changing domain starts a new collection.</p>';
  info('THE THRILL. A LITTLE MORE CONTROL.', '<p><strong>Welcome to The Bulk Hunter Slab Vault.</strong> Choose a pack, review its odds, and reveal a randomly selected demo slab. Each unique inventory unit can only be claimed once.</p>' + storage + '<p>Pack prices and values are illustrative. There are no payments, shipments, or cash-outs. Ten reference photos represent separate demo units marked with DEMO certificates.</p>');
}

function confirmDemoReset() {
  if (!browserDemo) return;
  info('RESET YOUR PERSONAL DEMO?', '<p>This restores the original sample vault and removes your collection, inventory edits, uploaded photos, and pack settings from this browser.</p><p>Other visitors are unaffected. Export your collection first if you want to keep a copy.</p>', {button:'RESET MY DEMO', cancel:true, onClick:async()=>{await resetDemo(); location.reload();}});
}

$('category-list').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  categoryId = button.dataset.category;
  renderCategories(); renderTiers(); renderPool();
  $('category-list').querySelector(`[data-category="${categoryId}"]`).focus();
});
$('tier-list').addEventListener('click', event => {
  const button = event.target.closest('[data-tier]');
  if (!button) return;
  tierId = button.dataset.tier;
  renderTiers(); renderPool();
  $('tier-list').querySelector(`[data-tier="${tierId}"]`).focus();
});
$('continue-button').addEventListener('click', () => { showStep('tier'); $('back-button').focus(); });
$('back-button').addEventListener('click', () => { showStep('category'); $('continue-button').focus(); });
$('open-button').addEventListener('click',startPack);
$('open-again').addEventListener('click',startPack);
$('reveal-pack-button').addEventListener('click',() => revealCard());
$('instant-reveal').addEventListener('click',() => revealCard(true));
$('close-reveal').addEventListener('click',closeReveal);
$('reveal-dialog').addEventListener('cancel',event => { event.preventDefault(); closeReveal(); });
$('view-collection').addEventListener('click',() => { closeReveal(); location.hash = 'collection'; route(); });
$('odds-button').addEventListener('click',() => { poolMode='all'; renderPool(); $('inventory-heading').scrollIntoView({behavior:'smooth'}); });
document.querySelector('.tabs').addEventListener('click',event => { const button=event.target.closest('[data-pool]'); if (button) { poolMode=button.dataset.pool; renderPool(); } });
document.querySelector('.tabs').addEventListener('keydown',event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault(); poolMode = event.key === 'Home' ? 'chases' : event.key === 'End' ? 'all' : poolMode === 'chases' ? 'all' : 'chases'; renderPool(); $(poolMode === 'all' ? 'tab-all' : 'tab-chases').focus();
});
for (const id of ['card-grid','collection-grid']) $(id).addEventListener('click',event => { const button=event.target.closest('[data-card]'); if (button) showCard(button.dataset.card); });
$('demo-info').addEventListener('click',showDemoInfo);
$('how-button').addEventListener('click',() => { location.hash='how-it-works'; route(); });
$('close-info').addEventListener('click',() => $('info-dialog').close());
$('info-cancel').addEventListener('click',() => $('info-dialog').close());
$('info-dialog').addEventListener('cancel',event=>{if($('info-done').disabled)event.preventDefault();});
$('reset-demo-button').addEventListener('click',confirmDemoReset);
$('collection-search').addEventListener('input',renderCollection);
$('collection-sort').addEventListener('change',renderCollection);
$('export-button').addEventListener('click',() => {
  const blob = new Blob([JSON.stringify({app:'The Bulk Hunter',demo:true,exportedAt:new Date().toISOString(),pulls:collection},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download='the-bulk-hunter-demo-collection.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Demo collection exported.');
});
if (browserDemo) {
  document.body.classList.add('browser-demo');
  $('demo-mode-label').textContent = 'PERSONAL DEMO · SAMPLE INVENTORY SAVED IN THIS BROWSER';
  $('reset-demo-button').hidden = false;
  $('collection-mode-copy').textContent = 'Your personal sample collection, saved in this browser. Every visitor has their own vault.';
}
window.addEventListener('hashchange',route);
renderCategories(); renderTiers(); renderPool(); renderCollection(); route();
(async()=>{await refreshCatalog();await refreshCollection();})().catch(error=>{catalogReady=false;renderTiers();toast(error.message||'The vault is offline. Please come back shortly.');});
window.addEventListener('focus',()=>{refreshCatalog().catch(()=>{});refreshCollection().catch(()=>{});});
fetch('assets/slabs.json').then(response=>response.ok?response.json():[]).then(photos=>{if(Array.isArray(photos)) sourcePhotos=photos;}).catch(()=>{});
