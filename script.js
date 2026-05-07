/* ═══════════════════════════════════════════
   SWS Document Dashboard — script.js
═══════════════════════════════════════════ */

const socket = io();

// ── State ──────────────────────────────────────────────────────────────────
let pendingFiles  = [];   // { file, id, name, size }
let notifications = [];
let documents     = [];

// ── DOM refs ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initUploadZone();
  loadDocuments();
  loadNotifications();
  initNotifPanel();
  initMobileMenu();
});

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════
function initNav() {
  $$('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const sec = el.dataset.section;
      switchSection(sec);
      $$('.nav-item').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      // Close sidebar on mobile after nav
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // "View all" link
  document.querySelectorAll('.view-all').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchSection(el.dataset.target);
      $$('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.section === el.dataset.target);
      });
    });
  });
}

function switchSection(name) {
  $$('.section').forEach(s => s.classList.add('hidden'));
  const target = $(`section-${name}`);
  if (target) target.classList.remove('hidden');
  $('pageTitle').textContent = name.charAt(0).toUpperCase() + name.slice(1);
}

// ══════════════════════════════════════════════
//  MOBILE MENU
// ══════════════════════════════════════════════
function initMobileMenu() {
  $('menuToggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });
  // Close sidebar on overlay click
  document.addEventListener('click', e => {
    const sidebar = document.querySelector('.sidebar');
    const toggle  = $('menuToggle');
    if (
      window.innerWidth <= 768 &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== toggle && !toggle.contains(e.target)
    ) closeSidebar();
  });
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
}

// ══════════════════════════════════════════════
//  UPLOAD ZONE
// ══════════════════════════════════════════════
function initUploadZone() {
  const zone  = $('dropZone');
  const input = $('fileInput');

  zone.addEventListener('click', e => {
    if (e.target === zone || e.target.classList.contains('drop-title') ||
        e.target.classList.contains('drop-sub')) {
      input.click();
    }
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    addToQueue([...e.dataTransfer.files]);
  });

  input.addEventListener('change', () => {
    addToQueue([...input.files]);
    input.value = '';
  });

  $('startUploadBtn').addEventListener('click', startUpload);
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 ** 2).toFixed(2) + ' MB';
}

function addToQueue(files) {
  const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { showToast('error', 'Invalid file', 'Only PDF files are accepted.'); return; }

  pdfs.forEach(file => {
    const id = 'q-' + Math.random().toString(36).slice(2, 9);
    pendingFiles.push({ file, id, name: file.name, size: file.size });
    renderQueueItem({ file, id, name: file.name, size: file.size });
  });

  $('queueSection').style.display = 'block';
}

function renderQueueItem({ id, name, size }) {
  const list = $('queueList');
  const div  = document.createElement('div');
  div.className = 'queue-item';
  div.id = `qi-${id}`;
  div.innerHTML = `
    <div class="queue-item-icon">PDF</div>
    <div class="queue-item-info">
      <div class="queue-item-name">${escHtml(name)}</div>
      <div class="queue-item-meta">
        <span class="queue-item-size">${fmtSize(size)}</span>
        <div class="progress-bar-wrap">
          <div class="progress-bar" id="pb-${id}"></div>
        </div>
        <span class="progress-pct" id="pct-${id}">0%</span>
      </div>
    </div>
    <div class="queue-status">
      <span class="status-chip pending" id="qs-${id}">
        <span class="status-dot"></span>Pending
      </span>
    </div>
  `;
  list.appendChild(div);
}

function setQueueStatus(id, status, pct = null) {
  const chip = $(`qs-${id}`);
  const pb   = $(`pb-${id}`);
  const pctEl= $(`pct-${id}`);
  if (!chip) return;

  chip.className = `status-chip ${status}`;
  const labels = { pending:'Pending', uploading:'Uploading', complete:'Complete', failed:'Failed' };
  chip.innerHTML = `<span class="status-dot"></span>${labels[status] || status}`;

  if (pb && pct !== null) {
    pb.style.width = pct + '%';
    if (status === 'complete') pb.classList.add('complete');
    if (status === 'failed')   pb.classList.add('failed');
  }
  if (pctEl && pct !== null) pctEl.textContent = pct + '%';
}

// ── Upload engine: one file at a time via XHR for progress ─────────────────
async function startUpload() {
  if (!pendingFiles.length) return;
  const files = [...pendingFiles];
  pendingFiles = [];

  const btn = $('startUploadBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  // Show banner if > 3 files
  if (files.length > 3) showBanner(true);

  const results = { uploaded: [], errors: [] };

  for (const item of files) {
    setQueueStatus(item.id, 'uploading', 0);
    try {
      const doc = await uploadSingle(item);
      results.uploaded.push(doc);
      setQueueStatus(item.id, 'complete', 100);
    } catch (err) {
      results.errors.push({ filename: item.name, error: err.message });
      setQueueStatus(item.id, 'failed', 0);
    }
  }

  hideBanner();
  btn.disabled = false;
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>Upload All`;

  if (results.uploaded.length) {
    showToast('success', 'Upload complete', `${results.uploaded.length} file(s) uploaded.`);
    await loadDocuments();
  }
  if (results.errors.length) {
    results.errors.forEach(e => showToast('error', 'Upload failed', `${e.filename}: ${e.error}`));
  }
}

function uploadSingle(item) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('files', item.file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90); // 0-90% during upload
        setQueueStatus(item.id, 'uploading', pct);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.uploaded && data.uploaded.length) {
            resolve(data.uploaded[0]);
          } else {
            const err = data.errors && data.errors[0];
            reject(new Error(err ? err.error : 'Unknown error'));
          }
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('POST', '/api/upload');
    xhr.send(fd);
  });
}

// ══════════════════════════════════════════════
//  DOCUMENTS
// ══════════════════════════════════════════════
async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    documents = await res.json();
    renderDocuments();
    updateStats();
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

function renderDocuments() {
  renderTable('recentTableBody', documents.slice(0, 5), false);
  renderTable('allDocsTableBody', documents, true);
  $('docCount').textContent = `${documents.length} file${documents.length !== 1 ? 's' : ''}`;
}

function renderTable(tbodyId, docs, showDelete) {
  const tbody = $(tbodyId);
  if (!docs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><span>No documents yet</span></td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(doc => `
    <tr>
      <td>
        <div class="file-cell">
          <div class="file-icon">PDF</div>
          <div class="file-name">
            ${escHtml(doc.filename)}
            <small>${doc.size}</small>
          </div>
        </div>
      </td>
      <td>${doc.size}</td>
      <td>${fmtDate(doc.uploaded_at)}</td>
      <td>
        <span class="status-chip ${doc.status}">
          <span class="status-dot"></span>
          ${cap(doc.status)}
        </span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" title="Download" onclick="downloadDoc('${doc.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          ${showDelete ? `
          <button class="btn-icon danger" title="Delete" onclick="deleteDoc('${doc.id}', '${escHtml(doc.filename)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <polyline points="3,6 5,6 21,6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function downloadDoc(id) {
  window.open(`/api/documents/${id}/download`, '_blank');
}

async function deleteDoc(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', 'Deleted', `"${name}" has been removed.`);
      await loadDocuments();
    }
  } catch (err) {
    showToast('error', 'Error', 'Could not delete the file.');
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────
function updateStats() {
  $('statTotal').textContent    = documents.length;
  $('statComplete').textContent = documents.filter(d => d.status === 'complete').length;

  const today = new Date().toISOString().slice(0, 10);
  $('statToday').textContent = documents.filter(d => d.uploaded_at.startsWith(today)).length;

  const totalBytes = documents.reduce((s, d) => s + (d.size_bytes || 0), 0);
  $('statSize').textContent = fmtSize(totalBytes);
}

// ══════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════
function initNotifPanel() {
  $('notifBtn').addEventListener('click',       openNotifPanel);
  $('closeNotifBtn').addEventListener('click',  closeNotifPanel);
  $('notifOverlay').addEventListener('click',   closeNotifPanel);
  $('markAllReadBtn').addEventListener('click', markAllRead);
}

function openNotifPanel() {
  $('notifPanel').classList.add('open');
  $('notifOverlay').classList.add('visible');
}

function closeNotifPanel() {
  $('notifPanel').classList.remove('open');
  $('notifOverlay').classList.remove('visible');
}

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    notifications = await res.json();
    renderNotifications();
    updateBadge();
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

function renderNotifications() {
  const list = $('notifList');
  if (!notifications.length) {
    list.innerHTML = '<p class="notif-empty">No notifications yet</p>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" onclick="markRead('${n.id}')">
      <span class="notif-dot ${n.type}"></span>
      <div class="notif-content">
        <p class="notif-msg">${escHtml(n.message)}</p>
        <p class="notif-time">${timeAgo(n.created_at)}</p>
      </div>
    </div>
  `).join('');
}

async function markRead(id) {
  const notif = notifications.find(n => n.id === id);
  if (!notif || notif.is_read) return;
  try {
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    notif.is_read = 1;
    renderNotifications();
    updateBadge();
  } catch {}
}

async function markAllRead() {
  try {
    await fetch('/api/notifications/read-all', { method: 'PATCH' });
    notifications.forEach(n => n.is_read = 1);
    renderNotifications();
    updateBadge();
  } catch {}
}

function updateBadge() {
  const unread = notifications.filter(n => !n.is_read).length;
  const badge  = $('notifBadge');
  if (unread) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ══════════════════════════════════════════════
//  SOCKET.IO — realtime events
// ══════════════════════════════════════════════
socket.on('connect', () => console.log('[socket] connected'));

socket.on('new_notification', notif => {
  notifications.unshift(notif);
  renderNotifications();
  updateBadge();
  showToast(notif.type, 'Notification', notif.message);
});

socket.on('file_status', ({ id, status, filename }) => {
  console.log('[socket] file_status', id, status, filename);
});

// ══════════════════════════════════════════════
//  BANNER
// ══════════════════════════════════════════════
function showBanner(show) {
  $('uploadBanner').style.display = show ? 'flex' : 'none';
}
function hideBanner() { showBanner(false); }

// ══════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════
function showToast(type, title, msg) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-body">
      <p class="toast-title">${escHtml(title)}</p>
      <p class="toast-msg">${escHtml(msg)}</p>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn .3s ease reverse';
    setTimeout(() => toast.remove(), 280);
  }, 4000);
}

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 ** 2).toFixed(2) + ' MB';
}

function fmtDate(str) {
  try {
    const d = new Date(str);
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) +
           ' ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  } catch { return str; }
}

function timeAgo(str) {
  try {
    const diff = (Date.now() - new Date(str).getTime()) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  } catch { return str; }
}
