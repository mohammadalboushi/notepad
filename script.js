const firebaseConfig = {
  apiKey: "AIzaSyBB_U4C880PW4GxZd8FALv8yBSiP2mNeBY",
  authDomain: "malaboushi.firebaseapp.com",
  projectId: "malaboushi",
  storageBucket: "malaboushi.firebasestorage.app",
  messagingSenderId: "110336819350",
  appId: "1:110336819350:web:2b1b0488e72b811f0602b7",
  measurementId: "G-94ZT4TQYZY"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

const APP_PASS_KEY = 'smartNotes_appPass';
const LOCAL_DATA_KEY = 'smartNotes_localData'; 

let allData = [];
let currentFolderId = null;
let searchMatches = [], currentSearchIndex = -1;
let historyStack = [], historyIndex = -1, originalContent = '';
let itemsClipboard = [], isPasteMode = false, clipboardAction = 'move';
let activeCardId = null, currentNoteId = null, activeSubNoteIndex = null;
let isMainSelectionMode = false, selectedMainIds = new Set();
let isSelectionMode = false, selectedSubIndices = new Set();
let activeEditResolve = null;

let saveTimeout = null; 
let unsubscribeNotes = null;
let currentUid = null;

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('searchInput').value = '';
  loadData(); 
  document.getElementById('searchInput').addEventListener('focus', pushState);
  document.getElementById('editTextArea').addEventListener('input', function() { saveHistory(this.value); });
  document.getElementById('editSaveBtn').onclick = () => { window.history.back(); };
  document.addEventListener('click', e => {
    const cm = document.getElementById('createMenu');
    if(cm.classList.contains('open') && !e.target.closest('#createMenu') && !e.target.closest('.fab'))
      { cm.classList.remove('open'); cm.style.display = 'none'; }
  });

  const savedTheme = localStorage.getItem('smartNotes_theme');
  if(savedTheme === 'dark') {
      document.body.classList.add('dark-mode');
      updateThemeIcon(true);
  } else {
      updateThemeIcon(false);
  }
});

auth.onAuthStateChanged(user => {
    if (user) {
        currentUid = user.uid;
        checkGoogleLoginState();
        setupRealtimeListener(user.uid);
    } else {
        currentUid = null;
        if(unsubscribeNotes) { unsubscribeNotes(); unsubscribeNotes = null; }
        checkGoogleLoginState();
    }
});

function loadData() {
    const cachedData = localStorage.getItem(LOCAL_DATA_KEY);
    if (cachedData) {
        try { allData = JSON.parse(cachedData); renderMainGrid(); }
        catch (e) { console.error(e); }
    }
}

function saveData() { 
    localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(allData));
    document.getElementById('syncText').innerText = "جاري الحفظ...";
    setSyncLoader(true);
    saveToFirebase();
}

function saveToFirebase(silent = true) {
    if(!currentUid) return;
    const globalPass = localStorage.getItem(APP_PASS_KEY);
    db.collection('smartNotes').doc(currentUid).set({
        smartNotesData: allData,
        appGlobalPass: globalPass
    }).then(() => {
        setSyncLoader(false);
        document.getElementById('syncText').innerText = "";
        if(!silent) showNotif("تم الحفظ في السحابة", "success");
    }).catch(e => {
        setSyncLoader(false);
        document.getElementById('syncText').innerText = "";
        if(!silent) showNotif("فشل الرفع", "error");
    });
}

function setupRealtimeListener(uid) {
    setSyncLoader(true);
    unsubscribeNotes = db.collection('smartNotes').doc(uid).onSnapshot(docSnap => {
        if (docSnap.exists) {
            const data = docSnap.data();
            if(data.smartNotesData) {
                allData = data.smartNotesData;
                localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(allData));
            }
            if(data.appGlobalPass) {
                localStorage.setItem(APP_PASS_KEY, data.appGlobalPass);
            } else {
                localStorage.removeItem(APP_PASS_KEY);
            }
            renderMainGrid();
            if(currentNoteId) renderSubNotes();
        }
        setSyncLoader(false);
    }, error => {
        setSyncLoader(false);
        showNotif("فشل المزامنة", "error");
    });
}

window.addEventListener('popstate', () => {
  const openSheet = ['ctxSheet', 'subCtxSheet', 'dragSheet', 'settingsSheet'].find(id => { const el = document.getElementById(id); return el && el.classList.contains('open'); });
  if(openSheet) { closeSheet(openSheet); return; }
  
  const editModal = document.getElementById('editModal');
  if(editModal.style.display === 'flex') { 
      const v = document.getElementById('editTextArea').value;
      if(v !== originalContent) {
          if(activeEditResolve) { activeEditResolve(v); activeEditResolve = null; }
          showNotif('تم الحفظ', 'success');
      } else {
          if(activeEditResolve) { activeEditResolve(null); activeEditResolve = null; }
      }
      editModal.style.display = 'none'; 
      document.getElementById('editSearchBar').style.display = 'none';
      return; 
  }

  const inputModal = document.getElementById('inputModal');
  if(inputModal.style.display === 'flex') { 
      inputModal.style.display = 'none'; 
      if(window._inputResolve) { window._inputResolve(null); window._inputResolve = null; }
      return; 
  }

  const detailsModal = document.getElementById('detailsModal');
  if(detailsModal.style.display === 'flex') { 
      detailsModal.style.display = 'none';
      document.getElementById('subSearchInput').value = ''; 
      toggleSelectionMode(false);
      return; 
  }

  if(document.getElementById('searchInput').value) { clearSearch(); return; }
  if(currentFolderId !== null) { const pid = getParentFolderId(allData, currentFolderId); currentFolderId = (pid === undefined) ? null : pid; renderMainGrid(); return; }
});
function pushState() { window.history.pushState({open: true}, ''); }

function findNoteById(list, id) { id = parseFloat(id); for(let it of list){ if(parseFloat(it.id) === id) return it; if(it.type === 'folder' && it.items){ const f = findNoteById(it.items, id); if(f) return f; } } return null; }
function getCurrentList() { if(currentFolderId === null) return allData; const f = findNoteById(allData, currentFolderId); return f ? (f.items || []) : []; }
function getParentFolderId(list, targetId, parentId = null) { for(let it of list){ if(parseFloat(it.id) === parseFloat(targetId)) return parentId; if(it.type === 'folder' && it.items){ const f = getParentFolderId(it.items, targetId, it.id); if(f !== undefined) return f; } } return undefined; }
function removeItemFromTree(list, id) { for(let i = 0; i < list.length; i++){ if(parseFloat(list[i].id) === parseFloat(id)){ list.splice(i, 1); return true; } if(list[i].type === 'folder' && list[i].items && removeItemFromTree(list[i].items, id)) return true; } return false; }

function renderMainGrid(filter = '') {
  const grid = document.getElementById('notesGrid'); grid.innerHTML = '';
  const nav = document.getElementById('navBar');
  if(currentFolderId === null) { nav.style.display = 'none'; }
  else { nav.style.display = 'flex'; const f = findNoteById(allData, currentFolderId); document.getElementById('currentPathTitle').textContent = f ? `📁 ${f.title}` : ''; }
  
  const pb = document.getElementById('pasteFloatingBtn'), fab = document.getElementById('mainFab');
  if(isPasteMode) { pb.style.display = 'flex'; fab.style.display = 'none'; pb.childNodes[2].textContent = clipboardAction === 'move' ? ' لصق هنا (نقل)' : ' لصق هنا (نسخ)'; }
  else { pb.style.display = 'none'; fab.style.display = 'flex'; }
  
  const list = getCurrentList();
  const filtered = list.filter(n => n.title.toLowerCase().includes(filter.toLowerCase()));
  if(!filtered.length) { grid.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p class="empty-text">لا توجد عناصر هنا بعد</p></div>`; return; }
  
  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = `note-card ${item.type === 'folder' ? 'is-folder' : 'is-note'}`;
    card.dataset.id = item.id; card.dataset.type = item.type; card.draggable = true;
    if(selectedMainIds.has(item.id)) card.classList.add('selected');
    
    let iconHtml = '', iconClass = 'note-ico';
    if(item.isLocked) { iconClass = 'locked-ico'; iconHtml = `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`; }
    else if(item.type === 'folder') { iconClass = 'folder-ico'; iconHtml = `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`; }
    else if(item.type === 'note') { iconClass = 'note-ico'; iconHtml = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; }
    else { iconClass = 'locked-ico'; iconHtml = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`; }
    
    let countLabel = `<div class="card-count">${item.items ? item.items.length : 0} ${item.type === 'folder' ? 'عنصر' : 'ملاحظة'}</div>`;
    if(item.type === 'file') countLabel = `<div class="card-count">ملف قديم</div>`;
    
    const selCheckSvg = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
    
    card.innerHTML = `
      <div class="card-sel-icon">${selCheckSvg}</div>
      <div class="card-icon-wrap ${iconClass}">${iconHtml}</div>
      <div class="card-title">${item.title}</div>
      ${countLabel}
      ${!isMainSelectionMode ? `<div class="sort-handle"><svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>` : ''}
    `;
    
    let pressTimer = null, touchMoved = false, touchStartX = 0, touchStartY = 0, isLongPress = false;
    card.addEventListener('touchstart', e => {
      if(e.target.closest('.sort-handle')) return;
      touchMoved = false; isLongPress = false;
      touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
      pressTimer = setTimeout(() => {
        if(!touchMoved) {
          isLongPress = true;
          if(navigator.vibrate) navigator.vibrate(40);
          if(isMainSelectionMode) { toggleMainSelection(item.id); } else { showCtxSheet(item.id); }
        }
      }, 500);
    }, {passive: true});
    card.addEventListener('touchmove', e => {
      const dx = Math.abs(e.touches[0].clientX - touchStartX); const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if(dx > 8 || dy > 8) { touchMoved = true; clearTimeout(pressTimer); }
    }, {passive: true});
    card.addEventListener('touchend', e => {
      clearTimeout(pressTimer);
      if(isLongPress) { e.preventDefault(); return; }
      if(!touchMoved) { if(isMainSelectionMode) { e.preventDefault(); toggleMainSelection(item.id); } else { handleCardClick(e, item); } }
    }, {passive: false});
    card.addEventListener('click', e => { if(!('ontouchstart' in window)) { handleCardClick(e, item); } });
    card.oncontextmenu = e => { e.preventDefault(); if(!touchMoved && !isLongPress) { showCtxSheet(item.id); } };
    
    addDragEvents(card, item);
    grid.appendChild(card);
  });
  
  document.getElementById('clearSearchBtn').style.display = filter ? 'flex' : 'none';
}

function searchNotes() { renderMainGrid(document.getElementById('searchInput').value); }
function clearSearch() { document.getElementById('searchInput').value = ''; renderMainGrid(); }

function handleCardClick(e, item) {
  if(isMainSelectionMode) { toggleMainSelection(item.id); return; }
  if(e.target.closest('.sort-handle')) return;
  if(item.type === 'folder') { if(item.isLocked) { checkPassword(item, () => { currentFolderId = item.id; pushState(); renderMainGrid(); }); } else { currentFolderId = item.id; pushState(); renderMainGrid(); } }
  else if(item.type === 'file') { showNotif('الملفات القديمة غير مدعومة. للتحميل اضغط مطولاً.', 'info'); }
  else { if(item.isLocked) { checkPassword(item, () => openNoteDetails(item.id)); } else openNoteDetails(item.id); }
}

function openNoteDetails(id) { currentNoteId = id; pushState(); const n = findNoteById(allData, id); if(!n) return; document.getElementById('modalTitle').textContent = n.title; document.getElementById('detailsModal').style.display = 'flex'; renderSubNotes(); }

function renderSubNotes() {
  const el = document.getElementById('subNotesList'); el.innerHTML = '';
  const n = findNoteById(allData, currentNoteId); if(!n) return;
  const filter = document.getElementById('subSearchInput').value.toLowerCase();
  (n.items || []).forEach((content, i) => {
    if(filter && !content.toLowerCase().includes(filter)) return;
    const li = document.createElement('li'); li.className = 'sub-note-item';
    if(isSelectionMode && selectedSubIndices.has(i)) li.classList.add('selected');
    
    let words = content.trim().split(/\s+/);
    let previewText = words.slice(0, 5).join(' ');
    if(words.length > 5) previewText += '...';
    if(!previewText) previewText = 'ملاحظة جديدة';

    li.innerHTML = `<div class="sub-note-content">${previewText}</div><div style="padding:2px; color:#cbd5e1; cursor:pointer;" onclick="event.stopPropagation(); showSubCtxSheet(${i})"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg></div>`;
    let pt = null, tm = false, tsx = 0, tsy = 0, isLP = false;
    li.addEventListener('touchstart', e => { tm = false; isLP = false; tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; pt = setTimeout(() => { if(!tm) { isLP = true; if(navigator.vibrate) navigator.vibrate(40); showSubCtxSheet(i); } }, 500); }, {passive: true});
    li.addEventListener('touchmove', e => { if(Math.abs(e.touches[0].clientX - tsx) > 8 || Math.abs(e.touches[0].clientY - tsy) > 8) { tm = true; clearTimeout(pt); } }, {passive: true});
    li.addEventListener('touchend', e => { clearTimeout(pt); if(isLP) { e.preventDefault(); return; } if(!tm) { if(isSelectionMode) toggleSubSelection(i); else editSubNote(i); } });
    li.onclick = () => { if(!('ontouchstart' in window)) { if(isSelectionMode) toggleSubSelection(i); else editSubNote(i); } };
    li.oncontextmenu = e => { e.preventDefault(); if(!tm && !isLP) showSubCtxSheet(i); };
    el.appendChild(li);
  });
}

function addSubNote() { const inp = document.getElementById('newSubNoteInput'); if(!inp.value.trim()) return; const n = findNoteById(allData, currentNoteId); if(!n.items) n.items = []; n.items.unshift(inp.value.trim()); inp.value = ''; saveData(); renderSubNotes(); }
async function editSubNote(i) { const n = findNoteById(allData, currentNoteId); const v = await showEditModal(n.items[i]); if(v !== null) { n.items[i] = v; saveData(); renderSubNotes(); } }
function toggleSelectionMode(a) { isSelectionMode = a; selectedSubIndices.clear(); document.getElementById('selectBtn').style.display = a ? 'none' : 'flex'; ['selectAllBtn', 'cancelSelectionBtn', 'deleteSubBtn'].forEach(id => document.getElementById(id).style.display = a ? 'flex' : 'none'); renderSubNotes(); }
function toggleSubSelection(i) { selectedSubIndices.has(i) ? selectedSubIndices.delete(i) : selectedSubIndices.add(i); renderSubNotes(); }
function selectAllSubNotes() { const n = findNoteById(allData, currentNoteId); if(n && n.items) n.items.forEach((_, i) => selectedSubIndices.add(i)); renderSubNotes(); }
async function deleteSelectedSubNotesWrapper() { if(!selectedSubIndices.size) return; if(!await verifyAppPass()) return; if(await showConfirm('حذف العناصر المحددة؟')) { const n = findNoteById(allData, currentNoteId); Array.from(selectedSubIndices).sort((a,b) => b-a).forEach(i => n.items.splice(i, 1)); saveData(); toggleSelectionMode(false); } }

function showEditModal(initialValue = '') {
  pushState();
  const ta = document.getElementById('editTextArea');
  document.getElementById('editModal').style.display = 'flex';
  ta.value = initialValue;
  originalContent = initialValue;
  initHistory(initialValue);
  ta.blur();
  return new Promise(resolve => { activeEditResolve = resolve; });
}

function handleEditBack() { window.history.back(); }

function toggleEditSearch() { const bar = document.getElementById('editSearchBar'); const open = bar.style.display === 'flex'; bar.style.display = open ? 'none' : 'flex'; if(!open) { document.getElementById('inTextSearchInput').focus(); searchMatches = []; currentSearchIndex = -1; } }
function initHistory(v) { historyStack = [v]; historyIndex = 0; updUR(); }
function saveHistory(v) { if(historyIndex < historyStack.length - 1) historyStack = historyStack.slice(0, historyIndex + 1); historyStack.push(v); historyIndex++; updUR(); }
function undo() { if(historyIndex > 0) { historyIndex--; document.getElementById('editTextArea').value = historyStack[historyIndex]; updUR(); } }
function redo() { if(historyIndex < historyStack.length - 1) { historyIndex++; document.getElementById('editTextArea').value = historyStack[historyIndex]; updUR(); } }
function updUR() { document.getElementById('btnUndo').style.opacity = historyIndex > 0 ? '1' : '.3'; document.getElementById('btnRedo').style.opacity = historyIndex < historyStack.length - 1 ? '1' : '.3'; }
function findInText(dir) {
  const ta = document.getElementById('editTextArea'); const term = document.getElementById('inTextSearchInput').value; if(!term) return;
  if(!searchMatches.length || ta.value.indexOf(term, searchMatches[0]) !== searchMatches[0]) { searchMatches = []; let p = ta.value.indexOf(term); while(p > -1) { searchMatches.push(p); p = ta.value.indexOf(term, p + 1); } if(!searchMatches.length) { showNotif('لم يتم العثور', 'info'); return; } currentSearchIndex = -1; }
  if(dir === 'next') { currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length; } else { currentSearchIndex = (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length; }
  const mp = searchMatches[currentSearchIndex]; ta.focus(); ta.setSelectionRange(mp, mp + term.length); ta.scrollTop = (ta.value.substring(0, mp).split('\n').length - 2) * 24;
}

function showInputModal(msg, initVal = '', type = 'single', allowCopy = false, allowPaste = false) {
  pushState();
  document.getElementById('inputMessage').textContent = msg;
  const si = document.getElementById('modalInputSingle'), ai = document.getElementById('modalInputArea');
  si.style.display = type === 'single' ? 'block' : 'none'; ai.style.display = type === 'area' ? 'block' : 'none';
  document.getElementById('inputCopyBtn').style.display = allowCopy ? 'flex' : 'none';
  document.getElementById('inputPasteBtn').style.display = allowPaste ? 'flex' : 'none';
  const active = type === 'single' ? si : ai; active.value = initVal;
  document.getElementById('inputModal').style.display = 'flex';
  setTimeout(() => active.focus(), 300);
  return new Promise(resolve => {
    document.getElementById('inputBtn').onclick = () => { 
        if(window._inputResolve) { window._inputResolve(active.value); window._inputResolve = null; }
        window.history.back();
    };
    window.copyModalContent = () => { navigator.clipboard.writeText(active.value); showNotif('تم النسخ', 'success'); };
    window.pasteModalContent = async () => { try { active.value = await navigator.clipboard.readText(); } catch(e) { showNotif('تعذر الوصول للحافظة', 'error'); } };
    window._inputResolve = resolve;
  });
}

function closeInputModal() { window.history.back(); }

function showConfirm(msg) { document.getElementById('confirmMessage').textContent = msg; document.getElementById('confirmModal').style.display = 'flex'; return new Promise(r => { window.hideConfirmModal = res => { document.getElementById('confirmModal').style.display = 'none'; r(res); }; }); }
function showPasswordModal() { document.getElementById('modalPasswordInput').value = ''; document.getElementById('passwordModal').style.display = 'flex'; setTimeout(() => document.getElementById('modalPasswordInput').focus(), 200); return new Promise(r => { document.getElementById('passwordBtn').onclick = () => { const v = document.getElementById('modalPasswordInput').value; document.getElementById('passwordModal').style.display = 'none'; r(v); }; window.hidePasswordModal = v => { document.getElementById('passwordModal').style.display = 'none'; r(v); }; }); }

async function checkPassword(item, cb) { 
  const p = await showPasswordModal(); 
  if(!p) return false; 
  const hashed = await hashPassword(p);
  if(hashed === item.passwordHash || btoa(p) === item.passwordHash) { 
    if(cb) cb(); 
    return true; 
  } else { 
    showNotif('كلمة المرور خاطئة', 'error'); 
    return false; 
  } 
}

async function verifyAppPass() { 
  const sp = localStorage.getItem(APP_PASS_KEY); 
  if(!sp) return true; 
  const p = await showPasswordModal(); 
  if(!p) return false;
  const hashed = await hashPassword(p);
  if(hashed === sp || btoa(p) === sp) return true; 
  showNotif('كلمة مرور خاطئة', 'error'); 
  return false; 
}

function openSheet(id) { document.getElementById('ctxOverlay').style.display = 'block'; requestAnimationFrame(() => document.getElementById(id).classList.add('open')); pushState(); }
function closeSheet(id) { document.getElementById(id).classList.remove('open'); document.getElementById('ctxOverlay').style.display = 'none'; }
function closeAllMenus() { ['ctxSheet', 'subCtxSheet', 'dragSheet', 'settingsSheet'].forEach(id => document.getElementById(id).classList.remove('open')); document.getElementById('ctxOverlay').style.display = 'none'; const cm = document.getElementById('createMenu'); cm.classList.remove('open'); cm.style.display = 'none'; }

function showCtxSheet(id) {
  const isMulti = isMainSelectionMode && selectedMainIds.size > 0;
  let item = null;
  
  if(isMulti) {
    const sel = getCurrentList().filter(n => selectedMainIds.has(n.id));
    const allLocked = sel.every(n => n.isLocked);
    document.getElementById('ctxLockLabel').textContent = allLocked ? 'فتح قفل المحدد' : 'قفل المحدد';
    document.getElementById('ctxEditBtn').style.display = 'none';
  } else {
    activeCardId = id;
    item = findNoteById(allData, id);
    if(!item) return;
    document.getElementById('ctxLockLabel').textContent = item.isLocked ? 'فتح القفل' : 'قفل';
    document.getElementById('ctxEditBtn').style.display = 'flex';
  }

  document.getElementById('ctxLockBtn').style.display = 'flex';
  document.getElementById('ctxHomeBtn').style.display = currentFolderId !== null ? 'flex' : 'none';
  openSheet('ctxSheet');
}
function showSubCtxSheet(i) { activeSubNoteIndex = i; openSheet('subCtxSheet'); }

async function handleMenuAction(action) {
  closeSheet('ctxSheet'); 
  const isMulti = isMainSelectionMode && selectedMainIds.size > 0;
  let item = null;
  
  if(!isMulti) {
    item = findNoteById(allData, activeCardId);
    if(!item) return;
  }
  
  if(action === 'delete') {
    if(isMulti) { deleteSelectedMainNotesWrapper(); return; }
    if(!await verifyAppPass()) return;
    if(item.isLocked) { 
      const p = await showPasswordModal(); 
      if(!p) return;
      const hashed = await hashPassword(p);
      if(hashed !== item.passwordHash && btoa(p) !== item.passwordHash) { 
        showNotif('كلمة المرور خاطئة', 'error'); return; 
      } 
    }
    if(await showConfirm(`حذف "${item.title}"؟`)) { removeItemFromTree(allData, activeCardId); saveData(); renderMainGrid(); }
  }
  else if(action === 'edit') {
    if(item.isLocked && !await checkPassword(item)) return;
    const t = await showInputModal(item.type === 'folder' ? 'اسم المجلد:' : 'عنوان الملاحظة:', item.title, 'single');
    if(t) { item.title = t; saveData(); renderMainGrid(); }
  }
  else if(action === 'toggleLock') {
    const sp = localStorage.getItem(APP_PASS_KEY); 
    
    if(isMulti) {
      const sel = getCurrentList().filter(n => selectedMainIds.has(n.id));
      const allLocked = sel.every(n => n.isLocked);
      if(allLocked) {
        const p = await showPasswordModal();
        if(p) {
          const hashedP = await hashPassword(p);
          const btoaP = btoa(p);
          let c = 0;
          sel.forEach(it => { 
            if(it.passwordHash === hashedP || it.passwordHash === btoaP) { 
              it.isLocked = false; it.passwordHash = null; c++; 
            } 
          });
          showNotif(c > 0 ? `تم فتح ${c} عنصر` : 'كلمة المرور خاطئة', c > 0 ? 'success' : 'error');
        }
      } else {
        const p = await showPasswordModal();
        if(!p) return;
        const hashedP = await hashPassword(p);
        
        if (sp && hashedP !== sp && btoa(p) !== sp) {
          showNotif('كلمة المرور لا تطابق إعدادات التطبيق!', 'error');
          return;
        }

        sel.forEach(it => { it.isLocked = true; it.passwordHash = hashedP; });
        showNotif('تم القفل بنجاح', 'success');
      }
      toggleMainSelectionMode(false);
    } else {
      if(item.isLocked) { 
        if(await checkPassword(item)) { item.isLocked = false; item.passwordHash = null; showNotif('تم فتح القفل', 'success'); } 
      } else { 
        const p = await showPasswordModal(); 
        if(!p) return;
        const hashedP = await hashPassword(p);
        
        if (sp && hashedP !== sp && btoa(p) !== sp) {
          showNotif('كلمة المرور لا تطابق إعدادات التطبيق!', 'error');
          return;
        }

        item.isLocked = true; item.passwordHash = hashedP; showNotif('تم القفل', 'success'); 
      }
    }
    saveData(); renderMainGrid();
  }
  else if(action === 'move' || action === 'copy') {
    if(!await verifyAppPass()) return;
    const list = getCurrentList();
    itemsClipboard = isMulti ? list.filter(n => selectedMainIds.has(n.id)) : [item];
    clipboardAction = action; isPasteMode = true;
    toggleMainSelectionMode(false); renderMainGrid();
    showNotif(action === 'move' ? 'تم القص — انتقل للوجهة واضغط لصق' : 'تم النسخ — انتقل للوجهة واضغط لصق', 'info');
  }
  else if(action === 'moveToRoot') {
    if(currentFolderId === null) return; if(!await verifyAppPass()) return;
    const list = getCurrentList(); const items = isMulti ? list.filter(n => selectedMainIds.has(n.id)) : [item];
    if(await showConfirm('إضافة العناصر للواجهة الرئيسية؟')) {
      const folder = findNoteById(allData, currentFolderId);
      items.forEach(it => { folder.items = folder.items.filter(n => n.id !== it.id); allData.unshift(it); });
      saveData(); toggleMainSelectionMode(false); renderMainGrid(); showNotif('تمت الإضافة', 'success');
    }
  }
}

async function handleSubNoteAction(action) {
  closeSheet('subCtxSheet');
  const n = findNoteById(allData, currentNoteId);
  if(action === 'delete') { if(!await verifyAppPass()) return; n.items.splice(activeSubNoteIndex, 1); saveData(); renderSubNotes(); }
  else if(action === 'copy') { navigator.clipboard.writeText(n.items[activeSubNoteIndex]); showNotif('تم النسخ', 'success'); }
  else if(action === 'edit') { editSubNote(activeSubNoteIndex); }
}

async function pasteItemsHere() {
  if(!isPasteMode || !itemsClipboard.length) return;
  if(clipboardAction === 'move') { itemsClipboard.forEach(c => removeItemFromTree(allData, c.id)); getCurrentList().unshift(...itemsClipboard); }
  else { itemsClipboard.forEach(it => { const copy = JSON.parse(JSON.stringify(it)); copy.id = Date.now() + Math.random(); copy.title += ' (نسخة)'; getCurrentList().unshift(copy); }); }
  saveData(); itemsClipboard = []; isPasteMode = false; renderMainGrid(); showNotif('تم اللصق ✅', 'success');
}

function toggleMainSelectionMode(active) {
  isMainSelectionMode = active; if(!active) selectedMainIds.clear();
  const tb = document.getElementById('selToolbar'); tb.classList.toggle('active', active);
  document.getElementById('mainSelectBtn').textContent = active ? 'إلغاء' : 'تحديد';
  renderMainGrid();
}
function toggleMainSelection(id) { selectedMainIds.has(id) ? selectedMainIds.delete(id) : selectedMainIds.add(id); renderMainGrid(); }
function handleSelectionAction(action) {
  const list = getCurrentList();
  if(action === 'selectAll') { if(selectedMainIds.size === list.length) selectedMainIds.clear(); else list.forEach(i => selectedMainIds.add(i.id)); isMainSelectionMode = true; renderMainGrid(); }
}
async function deleteSelectedMainNotesWrapper() {
  if(!selectedMainIds.size) return; if(!await verifyAppPass()) return;
  const list = getCurrentList(); const locked = list.filter(n => selectedMainIds.has(n.id) && n.isLocked);
  if(locked.length) { 
    const p = await showPasswordModal(); 
    if(!p) return;
    const hashed = await hashPassword(p);
    if(locked[0].passwordHash !== hashed && locked[0].passwordHash !== btoa(p)) { 
      showNotif('كلمة المرور خاطئة', 'error'); return; 
    } 
  }
  if(await showConfirm(`حذف ${selectedMainIds.size} عناصر؟`)) { selectedMainIds.forEach(id => removeItemFromTree(allData, id)); saveData(); toggleMainSelectionMode(false); showNotif('تم الحذف', 'success'); }
}

let dragSrcId = null, mobileDragEl = null, mobileDragClone = null, lastTargetEl = null;

function addDragEvents(card, item) {
  card.addEventListener('dragstart', e => { dragSrcId = parseFloat(card.dataset.id); card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragSrcId); });
  card.addEventListener('dragover', e => { e.preventDefault(); });
  card.addEventListener('dragenter', () => card.classList.add('drag-target'));
  card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
  card.addEventListener('drop', async e => { e.stopPropagation(); document.querySelectorAll('.note-card').forEach(c => c.classList.remove('drag-target')); const tid = parseFloat(card.dataset.id); if(dragSrcId === tid) return; if(card.dataset.type === 'folder') { const a = await showDragSheet(); if(a === 'move') moveItemsToFolder(tid); else if(a === 'swap') reorderItems(dragSrcId, tid); } else reorderItems(dragSrcId, tid); });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.note-card').forEach(c => c.classList.remove('drag-target')); });
  
  const handle = card.querySelector('.sort-handle');
  if(handle) {
    let tm = false, tsx = 0, tsy = 0;
    handle.addEventListener('touchstart', e => { e.stopPropagation(); tm = false; tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; mobileDragEl = card; dragSrcId = parseFloat(card.dataset.id); mobileDragClone = card.cloneNode(true); mobileDragClone.className = 'note-card dragging-mobile'; document.body.appendChild(mobileDragClone); updateClonePos(tsx, tsy); card.style.opacity = '.3'; }, {passive: true});
    handle.addEventListener('touchmove', e => { if(!mobileDragClone) return; const t = e.touches[0]; updateClonePos(t.clientX, t.clientY); mobileDragClone.style.display = 'none'; let el = document.elementFromPoint(t.clientX, t.clientY); mobileDragClone.style.display = 'flex'; const tc = el?.closest('.note-card'); if(lastTargetEl && lastTargetEl !== tc) lastTargetEl.classList.remove('drag-target-hover'); if(tc && tc !== mobileDragEl) { tc.classList.add('drag-target-hover'); lastTargetEl = tc; } else lastTargetEl = null; }, {passive: true});
    handle.addEventListener('touchend', async () => { if(!mobileDragClone) return; mobileDragClone.remove(); mobileDragClone = null; if(mobileDragEl) mobileDragEl.style.opacity = '1'; if(lastTargetEl) { lastTargetEl.classList.remove('drag-target-hover'); const tid = parseFloat(lastTargetEl.dataset.id); if(lastTargetEl.dataset.type === 'folder') { const a = await showDragSheet(); if(a === 'move') moveItemsToFolder(tid); else if(a === 'swap') reorderItems(dragSrcId, tid); } else reorderItems(dragSrcId, tid); } mobileDragEl = null; lastTargetEl = null; }, {passive: true});
  }
}

function updateClonePos(x, y) { if(mobileDragClone) { mobileDragClone.style.left = (x - 77) + 'px'; mobileDragClone.style.top = (y - 77) + 'px'; } }

function showDragSheet() { openSheet('dragSheet'); return new Promise(r => { window.resolveDragAction = action => { closeSheet('dragSheet'); r(action); }; }); }
function moveItemsToFolder(tfid) { const list = getCurrentList(); const tf = findNoteById(allData, tfid); if(!tf || tf.type !== 'folder') return; const items = (selectedMainIds.has(dragSrcId) && selectedMainIds.size > 1) ? list.filter(n => selectedMainIds.has(n.id) && n.id !== tfid) : list.filter(n => parseFloat(n.id) === dragSrcId && n.id !== tfid); if(!items.length) return; items.forEach(it => removeItemFromTree(allData, it.id)); items.forEach(it => tf.items.unshift(it)); saveData(); if(selectedMainIds.has(dragSrcId)) toggleMainSelectionMode(false); else renderMainGrid(); }
function reorderItems(srcId, targetId) { const list = getCurrentList(); const si = list.findIndex(n => parseFloat(n.id) === srcId); const ti = list.findIndex(n => parseFloat(n.id) === targetId); if(si < 0 || ti < 0 || si === ti) return; const [m] = list.splice(si, 1); list.splice(ti, 0, m); saveData(); renderMainGrid(); }

function showCreateMenu() { const cm = document.getElementById('createMenu'); if(cm.classList.contains('open')) { cm.classList.remove('open'); setTimeout(() => cm.style.display = 'none', 200); } else { cm.style.display = 'flex'; requestAnimationFrame(() => cm.classList.add('open')); } }
async function createItemWrapper(type) { document.getElementById('createMenu').classList.remove('open'); document.getElementById('createMenu').style.display = 'none'; const title = await showInputModal(type === 'folder' ? 'اسم المجلد:' : 'عنوان الملاحظة:', '', 'single'); if(title) { const ni = { id: Date.now(), type, title, items: [], isLocked: false }; getCurrentList().unshift(ni); saveData(); renderMainGrid(); if(type === 'note') openNoteDetails(ni.id); } }

async function handleSettingsOpen() { 
  const sp = localStorage.getItem(APP_PASS_KEY); 
  if(sp) { 
    const p = await showPasswordModal(); 
    if(!p) return;
    const hashed = await hashPassword(p);
    if(hashed !== sp && btoa(p) !== sp) { 
      showNotif('كلمة مرور خاطئة', 'error'); return; 
    } 
  } 
  updateSettingsUI(); openSheet('settingsSheet'); 
}

function updateSettingsUI() { const has = !!localStorage.getItem(APP_PASS_KEY); document.getElementById('setPassBtn').style.display = has ? 'none' : 'flex'; document.getElementById('removePassBtn').style.display = has ? 'flex' : 'none'; }

async function setAppPassword() { 
  closeSheet('settingsSheet'); 
  setTimeout(async () => { 
    const p = await showPasswordModal(); 
    if(p) { 
      const hashed = await hashPassword(p);
      localStorage.setItem(APP_PASS_KEY, hashed); 
      saveData(); 
      showNotif('تم القفل بنجاح', 'success'); 
    } 
  }, 350); 
}

function removeAppPassword() { closeSheet('settingsSheet'); setTimeout(async () => { if(await showConfirm('حذف كلمة مرور التطبيق؟')) { localStorage.removeItem(APP_PASS_KEY); saveData(); showNotif('تم حذف كلمة المرور', 'info'); } }, 350); }

function deleteAllData() { 
  closeSheet('settingsSheet'); 
  setTimeout(async () => { 
    if(!await showConfirm('حذف جميع البيانات نهائياً؟')) { return; } 
    if(!await showConfirm('هل أنت متأكد تماماً؟ سيتم حذفها من السحابة أيضاً!')) { return; } 
    allData = []; saveData(); renderMainGrid(); showNotif('تم حذف جميع البيانات', 'info'); 
  }, 350); 
}

function exportDataManual() { closeSheet('settingsSheet'); setTimeout(() => showInputModal('نسخة احتياطية (كود) — انسخ الكل:', JSON.stringify(allData), 'area', true), 400); }
function importDataPaste() { closeSheet('settingsSheet'); setTimeout(async () => { const t = await showInputModal('الصق نص النسخة:', '', 'area', false, true); if(t) { try { let c = t.trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'); allData = JSON.parse(c); saveData(); renderMainGrid(); showNotif('تم الاستيراد بنجاح', 'success'); } catch(err) { showNotif('الكود غير صالح', 'error'); } } }, 350); }

function downloadJSON() {
  closeSheet('settingsSheet');
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allData));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "smart_notes_backup.json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  showNotif('تم التنزيل', 'success');
}

function importJSON() {
  closeSheet('settingsSheet');
  document.getElementById('jsonFileInput').click();
}

function handleJSONImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let c = e.target.result.trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
      allData = JSON.parse(c);
      saveData();
      renderMainGrid();
      showNotif('تم الاستيراد بنجاح', 'success');
    } catch (err) {
      showNotif('الملف غير صالح', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

async function shareBackupText() {
  closeSheet('settingsSheet');
  const backupText = JSON.stringify(allData);
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'نسخة احتياطية',
        text: backupText
      });
    } catch (err) {
      console.log(err);
    }
  } else {
    showInputModal('نسخ احتياطي (كود) — انسخ الكل:', backupText, 'area', true);
  }
}

function toggleGoogleAuth() {
    if (currentUid) {
        handleFirebaseLogout();
    } else {
        closeSheet('settingsSheet');
        showNotif("جاري الاتصال بجوجل...", "info");
        auth.signInWithPopup(provider).catch(e => {
            showNotif("فشل الدخول", "error");
        });
    }
}

function checkGoogleLoginState() {
    const authLabel = document.getElementById('googleAuthLabel');
    const authIconWrap = document.getElementById('googleAuthIconWrap');

    if(currentUid) {
        authLabel.textContent = 'تسجيل الخروج من جوجل';
        const photoUrl = auth.currentUser ? auth.currentUser.photoURL : null;
        if(photoUrl) {
            authIconWrap.innerHTML = `<img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" alt="User">`;
        } else {
            authIconWrap.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
        }
    } else {
        authLabel.textContent = 'تسجيل الدخول باستخدام جوجل';
        authIconWrap.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; margin: auto; stroke: none;">
                <path d="M22 12c0-.85-.08-1.68-.22-2.48H12v4.69h5.68c-.24 1.5-1.12 2.78-2.39 3.64v3.02h3.86c2.26-2.09 3.56-5.17 3.56-8.87z" fill="#4285F4"/>
                <path d="M12 22c2.81 0 5.17-.93 6.9-2.52l-3.86-3.02c-.93.63-2.12 1-3.04 1-2.34 0-4.32-1.58-5.02-3.71H3.02v3.12C4.75 20.32 8.08 22 12 22z" fill="#34A853"/>
                <path d="M6.98 13.75c-.18-.53-.28-1.1-.28-1.75s.1-1.22.28-1.75V7.13H3.02C2.37 8.43 2 9.94 2 12s.37 3.57 1.02 4.87l3.96-3.12z" fill="#FBBC05"/>
                <path d="M12 5.38c1.53 0 2.91.53 3.98 1.51l2.98-2.98C17.17 2.15 14.81 1 12 1 8.08 1 4.75 2.68 3.02 6.13l3.96 3.12c.7-2.13 2.68-3.87 5.02-3.87z" fill="#EA4335"/>
            </svg>`;
    }
}

function handleFirebaseLogout() {
    closeSheet('settingsSheet');
    setTimeout(async () => {
        if(await showConfirm("هل تريد تسجيل الخروج من السحابة؟")) {
            auth.signOut().then(() => {
                localStorage.removeItem(LOCAL_DATA_KEY);
                localStorage.removeItem(APP_PASS_KEY);
                allData = [];
                window.location.reload();
            });
        }
    }, 350);
}

function setSyncLoader(show) { document.getElementById('syncLoader').style.display = show ? 'inline-block' : 'none'; }

let notifTimer = null;
function showNotif(msg, type = 'info') { const t = document.getElementById('notifToast'); const icon = document.getElementById('notifIcon'); document.getElementById('notifMsg').textContent = msg; const colors = {success: '#10b981', error: '#ef4444', info: '#6366f1'}; t.style.background = colors[type] || colors.info; if(type === 'success') icon.innerHTML = '<polyline points="20 6 9 17 4 12"/>'; else if(type === 'error') icon.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'; else icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'; t.classList.add('show'); if(notifTimer) clearTimeout(notifTimer); notifTimer = setTimeout(() => t.classList.remove('show'), 2500); }

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('smartNotes_theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById('themeIcon');
    const metaThemeColor = document.getElementById('metaThemeColor');
    if(isDark) {
        icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>';
        if(metaThemeColor) metaThemeColor.content = '#0f172a';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
        if(metaThemeColor) metaThemeColor.content = '#ffffff';
    }
}