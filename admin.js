import {request, browserDemo, resetDemo} from './lib/transport.js';

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value) || 0);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const rarityLabels = { common: 'Collector', rare: 'Rare hit', legendary: 'Grail' };
const statusLabels = { active: 'Active', hidden: 'Hidden', reserved: 'Reserved', sold: 'Claimed in demo' };
const rarityIds = ['common', 'rare', 'legendary'];
const lockedStatuses = new Set(['reserved', 'sold']);
let slabs = [];
let tiers = [];
let categories = [];
let localDemo = false;
let authenticated = false;
let savingSlab = false;
let uploadingImage = false;
let savingSettings = false;
let inventoryPage = 1;
const inventoryPageSize = 12;
let toastTimer;
let previewTimer;

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, raw = false, headers = {}, requireAuth = true } = {}) {
  let response;
  try {
    response = await request(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new ApiError(browserDemo ? error.message || 'The browser sandbox could not complete this change. Check that browser storage is available and try again.' : 'The inventory server could not be reached. Check the connection and try again.', 0);
  }
  const contentType = response.headers.get('content-type') || '';
  let data = {};
  if (contentType.includes('application/json')) {
    try { data = await response.json(); } catch { /* Report malformed server output below. */ }
  }
  if (!response.ok) {
    if (response.status === 401 && requireAuth && authenticated) showLogin('Your session has ended. Sign in again to continue.');
    const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message;
    throw new ApiError(message || (response.status === 404 ? 'The inventory API is not available on this host. Run the inventory server or deploy the complete application.' : `The server could not complete this request (${response.status}).`), response.status);
  }
  if (!contentType.includes('application/json') && response.status !== 204) {
    throw new ApiError('The inventory API is not configured on this host. Run the inventory server or deploy the complete application.', response.status);
  }
  return data;
}

function message(element, text, type = '') {
  element.textContent = text;
  element.classList.toggle('error', type === 'error');
  element.classList.toggle('success', type === 'success');
  if (element.classList.contains('banner')) element.hidden = !text;
}

function toast(text) {
  clearTimeout(toastTimer);
  $('admin-toast').textContent = text;
  $('admin-toast').classList.add('visible');
  toastTimer = setTimeout(() => $('admin-toast').classList.remove('visible'), 4000);
}

function environment(text, offline = false) {
  const badge = $('environment');
  badge.replaceChildren(Object.assign(document.createElement('i'), { ariaHidden: 'true' }), document.createTextNode(text));
  badge.classList.toggle('offline', offline);
}

function showLogin(text = '', type = '') {
  authenticated = false;
  $('login-view').hidden = false;
  $('manager-view').hidden = true;
  $('logout-button').hidden = true;
  $('admin-password').disabled = false;
  $('password-toggle').disabled = false;
  $('login-button').disabled = false;
  if ($('slab-dialog').open) $('slab-dialog').close();
  if ($('confirm-dialog').open) $('confirm-dialog').close('cancel');
  message($('login-message'), text, type);
}

async function openManager(session) {
  authenticated = true;
  localDemo = session.localDemo === true;
  $('login-view').hidden = true;
  $('manager-view').hidden = false;
  $('local-mode-notice').hidden = !localDemo && !browserDemo;
  $('logout-button').hidden = localDemo || browserDemo;
  if (browserDemo) $('local-mode-notice').querySelector('p').innerHTML = '<strong>Your personal browser sandbox.</strong> Every browser has its own sample vault. No sign-in is needed, and there is no shared real stock. Inventory edits, photos, prices, odds, and demo claims are saved only in this browser.';
  $('admin-password').value = '';
  environment(browserDemo ? 'Browser sandbox' : localDemo ? 'Local sandbox' : 'Shared inventory');
  $('sync-label').textContent = browserDemo ? 'Personal sample inventory' : localDemo ? 'Local sandbox inventory' : 'Shared inventory';
  await loadInventory();
}

async function loadInventory({ quiet = false } = {}) {
  $('refresh-button').disabled = true;
  $('inventory-panel').setAttribute('aria-busy', 'true');
  if (!quiet) message($('manager-message'), '');
  try {
    const [inventory, settings] = await Promise.all([api('/api/admin/inventory'), api('/api/admin/settings')]);
    if (!Array.isArray(inventory.slabs) || !Array.isArray(settings.tiers) || !Array.isArray(settings.categories)) {
      throw new ApiError('The inventory server returned incomplete data. Refresh and try again.', 0);
    }
    slabs = inventory.slabs;
    tiers = settings.tiers;
    categories = settings.categories;
    populateSelects();
    renderStats();
    renderInventory();
    renderSettings();
    renderActivity(inventory.activity || []);
    environment(browserDemo ? 'Browser sandbox' : localDemo ? 'Local sandbox' : 'Shared inventory');
  } catch (error) {
    if (authenticated) {
      message($('manager-message'), error.message, 'error');
      $('showing-count').textContent = 'Inventory could not be loaded.';
      environment(browserDemo ? 'Browser storage needs attention' : 'Connection needs attention', true);
    }
    throw error;
  } finally {
    $('refresh-button').disabled = false;
    $('inventory-panel').removeAttribute('aria-busy');
  }
}

function fillOptions(select, entries, { empty = '', preserve = true } = {}) {
  const previous = preserve ? select.value : '';
  select.replaceChildren();
  if (empty) select.add(new Option(empty, ''));
  for (const item of entries) select.add(new Option(item.label || item.name || item.id, item.id));
  if (preserve && [...select.options].some(option => option.value === previous)) select.value = previous;
}

function populateSelects() {
  fillOptions($('filter-category'), categories, { empty: 'All categories' });
  fillOptions($('filter-tier'), tiers, { empty: 'All tiers' });
  fillOptions($('slab-category'), categories);
  fillOptions($('slab-tier'), tiers);
}

function renderStats() {
  const active = slabs.filter(slab => slab.status === 'active');
  $('stat-active').textContent = active.length;
  $('stat-reserved').textContent = slabs.filter(slab => slab.status === 'reserved').length;
  $('stat-sold').textContent = slabs.filter(slab => slab.status === 'sold').length;
  $('stat-value').textContent = money(active.reduce((sum, slab) => sum + (Number(slab.value) || 0), 0));
  $('inventory-count').textContent = slabs.length;
}

function renderActivity(activity) {
  const actions = { 'slab.added': 'Slab added', 'slab.updated': 'Slab updated', 'slab.removed': 'Slab removed', 'settings.updated': 'Prices & odds updated', 'image.uploaded': 'Slab photo uploaded', 'reservation.released': 'Reservation released' };
  const entries = activity.filter(item => Object.hasOwn(actions, item.action)).slice(0, 6);
  $('activity-section').hidden = entries.length === 0;
  $('activity-list').innerHTML = entries.map(item => {
    let detail;
    try { detail = typeof item.detail === 'string' ? JSON.parse(item.detail) : item.detail; } catch { detail = null; }
    const date = new Date(item.createdAt);
    const validDate = Number.isFinite(date.getTime());
    return `<li><span class="activity-mark" aria-hidden="true">${item.action === 'slab.added' ? '+' : item.action === 'slab.removed' ? '−' : '↗'}</span><div><strong>${escape(actions[item.action])}</strong><span>${escape(detail?.name || (item.action === 'settings.updated' ? 'Future openings use the saved configuration' : 'Inventory record saved'))}</span></div>${validDate ? `<time datetime="${date.toISOString()}" title="${escape(date.toLocaleString())}">${escape(date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time>` : ''}</li>`;
  }).join('');
}

function safeImage(value) {
  const path = String(value || '').trim();
  if (browserDemo && /^data:image\/(?:jpeg|png|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(path)) return path;
  if (/^(?:\.\/|\/)?assets\/[\w./-]+$/i.test(path) || /^\/api\/images\/[\w-]+$/i.test(path)) {
    return path.split('/').includes('..') ? '' : path;
  }
  try {
    const url = new URL(path);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function renderInventory() {
  const query = $('inventory-search').value.trim().toLowerCase();
  const category = $('filter-category').value;
  const tierId = $('filter-tier').value;
  const status = $('filter-status').value;
  const filtered = slabs.filter(slab => (!category || slab.category === category) && (!tierId || slab.tierId === tierId) && (!status || slab.status === status) && (!query || [slab.name, slab.set, slab.certNumber, slab.serial, slab.grader, slab.year].join(' ').toLowerCase().includes(query)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / inventoryPageSize));
  inventoryPage = Math.min(Math.max(inventoryPage, 1), pageCount);
  const start = (inventoryPage - 1) * inventoryPageSize;
  const visible = filtered.slice(start, start + inventoryPageSize);
  const categoryNames = Object.fromEntries(categories.map(category => [category.id, category.label]));
  const tierNames = Object.fromEntries(tiers.map(tier => [tier.id, tier.name]));
  $('inventory-body').innerHTML = visible.map(slab => {
    const id = escape(slab.id);
    const image = safeImage(slab.image);
    const isLocked = lockedStatuses.has(slab.status);
    const label = statusLabels[slab.status] || 'Unknown';
    return `<tr><td><div class="slab-cell">${image ? `<img class="table-image" src="${escape(image)}" alt="" loading="lazy">` : '<div class="table-image" aria-hidden="true"></div>'}<div><div class="slab-title">${escape(slab.name)}</div><div class="slab-subtitle">${escape(slab.year)} · ${escape(slab.set)}</div></div></div></td><td><div class="pool-name">${escape(tierNames[slab.tierId] || slab.tierId)} · ${escape(categoryNames[slab.category] || slab.category)}</div><span class="rarity-label ${rarityIds.includes(slab.rarity) ? slab.rarity : ''}">${escape(rarityLabels[slab.rarity] || slab.rarity)}</span></td><td><div class="grade-text">${escape(slab.grader)} ${escape(slab.grade)}</div><div class="cert-text" title="${escape(slab.certNumber || slab.serial || '')}">#${escape(slab.certNumber || slab.serial || '—')}</div></td><td><span class="value-text">${escape(money(slab.value))}</span></td><td><span class="status-badge ${Object.hasOwn(statusLabels, slab.status) ? slab.status : ''}">${escape(label)}</span></td><td><div class="row-actions">${isLocked ? `<span class="locked-label" title="${slab.status === 'reserved' && slab.expiresAt ? `Reserved until ${escape(new Date(slab.expiresAt).toLocaleString())}` : 'This slab is part of an opening and cannot be edited.'}">Locked</span>` : `<button class="action-button" type="button" data-action="edit" data-id="${id}" aria-label="Edit ${escape(slab.name)}">Edit</button><button class="action-button" type="button" data-action="${slab.status === 'active' ? 'hide' : 'activate'}" data-id="${id}" aria-label="${slab.status === 'active' ? 'Hide' : 'Activate'} ${escape(slab.name)}">${slab.status === 'active' ? 'Hide' : 'Activate'}</button><button class="action-button destructive" type="button" data-action="remove" data-id="${id}" aria-label="Remove ${escape(slab.name)}">Remove</button>`}</div></td></tr>`;
  }).join('');
  for (const image of $('inventory-body').querySelectorAll('img')) image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, { once: true });
  $('inventory-empty').hidden = filtered.length !== 0;
  const hasFilters = Boolean(query || category || tierId || status);
  $('empty-copy').textContent = hasFilters ? 'No slabs match your search. Try another filter.' : 'Add your first slab to start building the pool.';
  $('empty-add-button').hidden = hasFilters;
  $('clear-filters-button').hidden = !hasFilters;
  for (const row of $('inventory-body').rows) {
    const cert = row.querySelector('.cert-text');
    if (cert && /^#DEMO-/i.test(cert.textContent)) {
      cert.title = `Demo sample identifier, not a physical inventory certificate. ${cert.textContent}`;
      const marker = document.createElement('span');
      marker.className = 'sample-marker';
      marker.textContent = 'SAMPLE';
      marker.title = 'Seeded demo slab. Add your own physical slabs with their real certificates.';
      row.querySelector('.grade-text').append(marker);
    }
  }
  $('showing-count').textContent = filtered.length ? `Showing ${start + 1}–${Math.min(start + inventoryPageSize, filtered.length)} of ${filtered.length} slab${filtered.length === 1 ? '' : 's'}` : 'Showing 0 slabs';
  $('inventory-pagination').hidden = pageCount <= 1;
  $('inventory-page-label').textContent = `Page ${inventoryPage} of ${pageCount}`;
  $('inventory-previous').disabled = inventoryPage <= 1;
  $('inventory-next').disabled = inventoryPage >= pageCount;
}

function renderSettings() {
  $('tier-settings').innerHTML = tiers.map(tier => {
    const id = escape(tier.id);
    const color = /^#[\da-f]{3,8}$/i.test(tier.color || '') ? tier.color : '#315dff';
    return `<article class="tier-card" data-tier-id="${id}" style="--tier-color:${color}"><div class="tier-heading"><h3>${escape(tier.name)}</h3><span>PACK TIER</span></div><label for="price-${id}">Pack price</label><div class="price-field"><span aria-hidden="true">$</span><input id="price-${id}" name="price-${id}" data-price type="number" min="0" max="100000" step="0.01" value="${escape(tier.price)}" aria-label="${escape(tier.name)} pack price in dollars" required></div><p class="odds-legend">Hit frequency <span>PUBLIC ODDS</span></p>${rarityIds.map(rarity => `<div class="odds-field"><label for="odds-${id}-${rarity}"><i class="rarity-dot ${rarity}" aria-hidden="true"></i>${rarityLabels[rarity]}</label><div class="percent-input"><input id="odds-${id}-${rarity}" data-rarity="${rarity}" type="number" min="0" max="100" step="1" value="${escape(tier.odds?.[rarity] ?? 0)}" aria-label="${escape(tier.name)} ${rarityLabels[rarity]} chance in percent" required><span aria-hidden="true">%</span></div></div>`).join('')}<div class="odds-total"><span>TOTAL CHANCE</span><strong data-total>100%</strong></div><p class="tier-count" data-inventory-note></p></article>`;
  }).join('');
  updateOddsTotals();
}

function updateOddsTotals() {
  for (const card of $('tier-settings').querySelectorAll('[data-tier-id]')) {
    const fields = [...card.querySelectorAll('[data-rarity]')];
    const total = fields.reduce((sum, input) => sum + Number(input.value), 0);
    const valid = fields.every(input => input.value !== '' && Number.isInteger(Number(input.value)) && Number(input.value) >= 0 && Number(input.value) <= 100) && total === 100;
    card.querySelector('[data-total]').textContent = `${Number.isFinite(total) ? total : '—'}%${valid ? ' ✓' : ' · needs 100%'}`;
    card.querySelector('.odds-total').classList.toggle('invalid', !valid);
    const active = slabs.filter(slab => slab.tierId === card.dataset.tierId && slab.status === 'active');
    const missing = categories.flatMap(category => fields.filter(input => Number(input.value) > 0 && !active.some(slab => slab.category === category.id && slab.rarity === input.dataset.rarity)).map(input => `${rarityLabels[input.dataset.rarity]} in ${category.label}`));
    const note = card.querySelector('[data-inventory-note]');
    note.textContent = missing.length ? `Missing active inventory: ${missing.join('; ')}.` : `${active.length} active slabs across this tier's categories.`;
    note.classList.toggle('warning', missing.length > 0);
  }
}

function switchTab(next) {
  for (const name of ['inventory', 'settings']) {
    const selected = name === next;
    $(`${name}-tab`).classList.toggle('selected', selected);
    $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`${name}-tab`).tabIndex = selected ? 0 : -1;
    $(`${name}-panel`).hidden = !selected;
  }
}

function openEditor(slab = null) {
  if (!tiers.length || !categories.length) {
    message($('manager-message'), 'Load the inventory and pack settings before adding a slab.', 'error');
    return;
  }
  if (slab && lockedStatuses.has(slab.status)) return;
  $('slab-form').reset();
  $('slab-id').value = slab?.id || '';
  for (const [field, value] of Object.entries({ name: slab?.name || '', set: slab?.set || '', year: slab?.year || '', value: slab?.value ?? '', grader: slab?.grader || 'PSA', grade: slab?.grade ?? '', cert: slab?.certNumber || slab?.serial || '', image: slab?.image || '', category: slab?.category || categories[0].id, tier: slab?.tierId || tiers[0].id, rarity: slab?.rarity || 'common', status: slab?.status === 'hidden' ? 'hidden' : 'active' })) {
    $(`slab-${field}`).value = value;
  }
  $('slab-dialog-title').textContent = slab ? 'Edit slab' : 'Add a slab';
  $('save-slab-button').innerHTML = `${slab ? 'Save changes' : 'Add slab'} <span aria-hidden="true">→</span>`;
  message($('slab-message'), '');
  $('upload-photo-input').value = '';
  message($('upload-message'), '');
  updateImagePreview();
  updateValueBounds();
  $('slab-dialog').showModal();
  $('slab-name').focus();
}

function updateImagePreview() {
  const image = safeImage($('slab-image').value);
  const preview = $('slab-preview-image');
  if (!image) {
    preview.hidden = true;
    preview.removeAttribute('src');
    $('image-placeholder').hidden = false;
    $('image-placeholder').querySelector('p').textContent = 'Your slab preview';
    return;
  }
  preview.hidden = true;
  $('image-placeholder').hidden = false;
  $('image-placeholder').querySelector('p').textContent = 'Loading preview…';
  preview.onload = () => { preview.hidden = false; $('image-placeholder').hidden = true; };
  preview.onerror = () => { preview.hidden = true; $('image-placeholder').hidden = false; $('image-placeholder').querySelector('p').textContent = 'Image could not be loaded'; };
  preview.src = image;
}

function updateValueBounds() {
  const tier = tiers.find(item => item.id === $('slab-tier').value);
  if (!tier) return;
  const value = $('slab-value');
  value.min = tier.floor;
  value.max = tier.ceiling;
  $('slab-value-range').textContent = `${tier.name} range: ${money(tier.floor)}–${money(tier.ceiling)}.`;
}

function editorBusy(busy) {
  for (const control of $('slab-form').elements) control.disabled = busy;
  $('close-slab-dialog').disabled = busy;
  $('slab-form').setAttribute('aria-busy', String(busy));
}

async function saveSlab(event) {
  event.preventDefault();
  if (savingSlab || uploadingImage || !$('slab-form').reportValidity()) return;
  if (!safeImage($('slab-image').value)) {
    message($('slab-message'), 'Use an HTTPS image URL, an uploaded image, or a path inside this site’s assets folder.', 'error');
    $('slab-image').focus();
    return;
  }
  const id = $('slab-id').value;
  const body = {
    name: $('slab-name').value.trim(), set: $('slab-set').value.trim(), year: Number($('slab-year').value),
    grader: $('slab-grader').value.trim(), grade: Number($('slab-grade').value), certNumber: $('slab-cert').value.trim(),
    image: $('slab-image').value.trim(), category: $('slab-category').value, categoryId: $('slab-category').value, tierId: $('slab-tier').value,
    rarity: $('slab-rarity').value, value: Number($('slab-value').value), status: $('slab-status').value,
  };
  savingSlab = true;
  editorBusy(true);
  message($('slab-message'), 'Saving slab…');
  try {
    await api(id ? `/api/admin/slabs/${encodeURIComponent(id)}` : '/api/admin/slabs', { method: id ? 'PATCH' : 'POST', body });
    if (!id) inventoryPage = 1;
    $('slab-dialog').close();
    await loadInventory();
    toast(id ? 'Slab updated.' : 'Slab added to your inventory.');
  } catch (error) {
    if ($('slab-dialog').open) message($('slab-message'), error.message, 'error');
    else if (authenticated) message($('manager-message'), error.message, 'error');
  } finally {
    savingSlab = false;
    editorBusy(false);
  }
}

function confirmAction({ title, copy, action, destructive = false }) {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-copy').textContent = copy;
  $('confirm-action').textContent = action;
  $('confirm-action').classList.toggle('danger', destructive);
  dialog.returnValue = '';
  dialog.showModal();
  $('confirm-cancel').focus();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

async function manageSlab(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const slab = slabs.find(item => String(item.id) === button.dataset.id);
  if (!slab || lockedStatuses.has(slab.status)) return;
  const action = button.dataset.action;
  if (action === 'edit') return openEditor(slab);
  const details = {
    hide: { title: 'Take it off the shelf?', copy: `${slab.name} will be hidden from future pack openings. You can activate it again any time.`, action: 'Hide slab' },
    activate: { title: 'Add it to the pool?', copy: `${slab.name} will become available in its category, tier, and rarity pool using the current published odds.`, action: 'Activate slab' },
    remove: { title: 'Remove this slab?', copy: `${slab.name} will be removed from the active pool. Its record is retained for inventory history.`, action: 'Remove slab', destructive: true },
  }[action];
  if (!details || !await confirmAction(details)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/slabs/${encodeURIComponent(slab.id)}`, action === 'remove' ? { method: 'DELETE' } : { method: 'PATCH', body: { status: action === 'hide' ? 'hidden' : 'active' } });
    await loadInventory();
    toast(action === 'activate' ? 'Slab is active.' : action === 'hide' ? 'Slab hidden from the pool.' : 'Slab removed from the pool.');
  } catch (error) {
    if (authenticated) message($('manager-message'), error.message, 'error');
  } finally { button.disabled = false; }
}

async function saveSettings(event) {
  event.preventDefault();
  if (savingSettings || !$('settings-form').reportValidity()) return;
  const nextTiers = tiers.map(tier => {
    const card = [...$('tier-settings').querySelectorAll('[data-tier-id]')].find(item => item.dataset.tierId === tier.id);
    return { ...tier, price: Number(card.querySelector('[data-price]').value), odds: Object.fromEntries([...card.querySelectorAll('[data-rarity]')].map(input => [input.dataset.rarity, Number(input.value)])) };
  });
  const invalid = nextTiers.find(tier => Object.values(tier.odds).some(value => !Number.isInteger(value) || value < 0 || value > 100) || Object.values(tier.odds).reduce((sum, value) => sum + value, 0) !== 100);
  if (invalid) {
    message($('settings-message'), `${invalid.name} odds must be whole percentages that total exactly 100%.`, 'error');
    $(`odds-${invalid.id}-common`).focus();
    return;
  }
  savingSettings = true;
  for (const control of $('settings-form').elements) control.disabled = true;
  message($('settings-message'), 'Saving prices and odds…');
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { tiers: nextTiers } });
    tiers = nextTiers;
    message($('settings-message'), 'Saved. Prices and odds are updated for future openings.', 'success');
    toast('Pack prices and odds saved.');
  } catch (error) {
    message($('settings-message'), error.message, 'error');
  } finally {
    savingSettings = false;
    for (const control of $('settings-form').elements) control.disabled = false;
  }
}

function addUploadControl() {
  const container = document.createElement('div');
  container.className = 'upload-control';
  container.innerHTML = '<span class="upload-divider">OR UPLOAD A PHOTO</span><label class="upload-label" for="upload-photo-input"><span aria-hidden="true">↑</span> Choose a slab photo</label><input id="upload-photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><p class="upload-note">JPG, PNG, WebP, or AVIF · up to 750 KB</p><p class="form-message" id="upload-message" role="status" aria-live="polite"></p>';
  document.querySelector('.image-editor').append(container);
  $('upload-photo-input').addEventListener('change', uploadPhoto);
  const range = document.createElement('small');
  range.id = 'slab-value-range';
  $('slab-value').after(range);
  $('slab-value').setAttribute('aria-describedby', range.id);
  const activity = document.createElement('section');
  activity.id = 'activity-section';
  activity.className = 'activity-section';
  activity.hidden = true;
  activity.setAttribute('aria-labelledby', 'activity-title');
  activity.innerHTML = '<div class="activity-heading"><h2 id="activity-title">Recent activity</h2><span>LATEST INVENTORY CHANGES</span></div><ul id="activity-list" class="activity-list"></ul>';
  $('inventory-panel').append(activity);
  const pagination = document.createElement('nav');
  pagination.id = 'inventory-pagination';
  pagination.className = 'inventory-pagination';
  pagination.setAttribute('aria-label', 'Inventory pages');
  pagination.innerHTML = '<button id="inventory-previous" class="pagination-button" type="button" aria-label="Previous inventory page">← Previous</button><span id="inventory-page-label" aria-live="polite">Page 1</span><button id="inventory-next" class="pagination-button" type="button" aria-label="Next inventory page">Next →</button>';
  $('showing-count').after(pagination);
  $('inventory-previous').addEventListener('click', () => { inventoryPage--; renderInventory(); });
  $('inventory-next').addEventListener('click', () => { inventoryPage++; renderInventory(); });
}

async function uploadPhoto() {
  const file = $('upload-photo-input').files?.[0];
  if (!file || uploadingImage) return;
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
  if (!allowed.has(file.type)) {
    message($('upload-message'), 'Choose a JPG, PNG, WebP, or AVIF image.', 'error');
    $('upload-photo-input').value = '';
    return;
  }
  if (file.size > 750 * 1024 || file.size === 0) {
    message($('upload-message'), 'Choose a photo smaller than 750 KB.', 'error');
    $('upload-photo-input').value = '';
    return;
  }
  uploadingImage = true;
  editorBusy(true);
  message($('upload-message'), 'Uploading photo…');
  try {
    const result = await api('/api/admin/uploads', { method: 'POST', body: file, raw: true, headers: { 'Content-Type': file.type } });
    if (!safeImage(result.image)) throw new Error('The upload did not return a valid image address. Try again.');
    $('slab-image').value = result.image;
    updateImagePreview();
    message($('upload-message'), 'Photo uploaded. Save the slab to use it.', 'success');
  } catch (error) {
    message($('upload-message'), error.message, 'error');
  } finally {
    uploadingImage = false;
    editorBusy(false);
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-button').disabled = true;
  message($('login-message'), 'Signing in…');
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('admin-password').value }, requireAuth: false });
    const session = await api('/api/admin/session', { requireAuth: false });
    if (!session.authenticated) throw new Error('Sign-in did not complete. Check the password and try again.');
    await openManager(session);
  } catch (error) {
    if (!authenticated) message($('login-message'), error.message, 'error');
  } finally { $('login-button').disabled = false; }
});
$('password-toggle').addEventListener('click', () => {
  const visible = $('admin-password').type === 'password';
  $('admin-password').type = visible ? 'text' : 'password';
  $('password-toggle').textContent = visible ? 'Hide' : 'Show';
  $('password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('password-toggle').setAttribute('aria-pressed', String(visible));
});
$('logout-button').addEventListener('click', async () => {
  $('logout-button').disabled = true;
  try {
    await api('/api/admin/logout', { method: 'POST' });
    slabs = []; tiers = []; categories = [];
    showLogin('Signed out.');
    environment('Owner access');
    $('admin-password').focus();
  } catch (error) { message($('manager-message'), error.message, 'error'); }
  finally { $('logout-button').disabled = false; }
});
for (const name of ['inventory', 'settings']) {
  $(`${name}-tab`).addEventListener('click', () => switchTab(name));
  $(`${name}-tab`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 'inventory' : event.key === 'End' ? 'settings' : name === 'inventory' ? 'settings' : 'inventory';
      switchTab(next); $(`${next}-tab`).focus();
    }
  });
}
for (const id of ['inventory-search', 'filter-category', 'filter-tier', 'filter-status']) $(id).addEventListener(id === 'inventory-search' ? 'input' : 'change', () => { inventoryPage = 1; renderInventory(); });
$('clear-filters-button').addEventListener('click', () => { for (const id of ['inventory-search', 'filter-category', 'filter-tier', 'filter-status']) $(id).value = ''; inventoryPage = 1; renderInventory(); });
$('refresh-button').addEventListener('click', () => loadInventory().catch(() => {}));
for (const id of ['add-slab-button', 'empty-add-button']) $(id).addEventListener('click', () => openEditor());
$('inventory-body').addEventListener('click', manageSlab);
for (const id of ['close-slab-dialog', 'cancel-slab-button']) $(id).addEventListener('click', () => { if (!savingSlab && !uploadingImage) $('slab-dialog').close(); });
$('slab-dialog').addEventListener('cancel', event => { if (savingSlab || uploadingImage) event.preventDefault(); });
$('slab-form').addEventListener('submit', saveSlab);
$('slab-image').addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(updateImagePreview, 350); });
$('slab-tier').addEventListener('change', updateValueBounds);
$('tier-settings').addEventListener('input', () => { updateOddsTotals(); message($('settings-message'), 'Unsaved changes.'); });
$('settings-form').addEventListener('submit', saveSettings);
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close('cancel'));
$('confirm-action').addEventListener('click', () => $('confirm-dialog').close('confirm'));
$('reset-demo-button').addEventListener('click', async () => {
  if (!browserDemo) return;
  if (savingSlab || uploadingImage || savingSettings) { toast('Wait for the current change to finish saving.'); return; }
  if (!await confirmAction({title:'Reset your personal demo?', copy:'This restores the original sample vault and clears your collection, inventory edits, uploaded photos, and pack settings from this browser. Other visitors are unaffected.', action:'Reset my demo', destructive:true})) return;
  $('reset-demo-button').disabled = true;
  try { await resetDemo(); location.reload(); }
  catch (error) { message($('manager-message'), error.message || 'The demo could not be reset. Try again.', 'error'); }
  finally { $('reset-demo-button').disabled = false; }
});
if (browserDemo) {
  document.body.classList.add('browser-demo');
  $('browser-demo-banner').hidden = false;
  $('reset-demo-button').hidden = false;
  $('slab-image').removeAttribute('maxlength');
  $('manager-footer-copy').textContent = 'Your browser. Your sample vault. Your demo controls.';
}
addUploadControl();

try {
  const session = await api('/api/admin/session', { requireAuth: false });
  if (session.authenticated) await openManager(session);
  else if (session.configured === false) {
    showLogin('Admin access needs to be configured in the hosting settings before sign-in is available. Set the admin password and session secret, then refresh this page.', 'error');
    $('admin-password').disabled = true;
    $('password-toggle').disabled = true;
    $('login-button').disabled = true;
    environment('Admin setup required', true);
  } else { showLogin(); environment('Owner access'); }
} catch (error) {
  if (!authenticated) { showLogin(error.message, 'error'); environment(browserDemo ? 'Browser storage unavailable' : 'Server unavailable', true); }
}
