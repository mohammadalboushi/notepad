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

let accounts = [];
let folders = ["عام", "فيسبوك", "جوجل"];
let unsubscribeVault = null;

let longPressTimer, isLongPress = false;
let currentCtxId = null, currentCtxType = null;
let pendingCallback = null;
let activeFolder = 'All'; 
let isSelectionMode = false;
let selectedIds = new Set();
let isMoveAction = false; 
let folderRenameTarget = null;
let vaultPressTimer = null;
let currentSort = 'newest';

auth.onAuthStateChanged(user => {
    const userNameEl = document.getElementById('userName');
    const userEmailEl = document.getElementById('userEmail');
    const userAvatarEl = document.getElementById('userAvatar');
    const loginContainer = document.getElementById('googleLoginContainer');
    const logoutContainer = document.getElementById('googleLogoutContainer');

    if (user) {
        loginContainer.style.display = 'none';
        logoutContainer.style.display = 'block';
        
        if(userNameEl) userNameEl.innerText = user.displayName || "مستخدم";
        if(userEmailEl) userEmailEl.innerText = user.email || "";
        
        const photoUrl = user.photoURL;
        if(photoUrl && userAvatarEl) {
            userAvatarEl.innerHTML = `<img src="${photoUrl}" alt="User">`;
        }
        setupRealtimeListener(user.uid);
    } else {
        loginContainer.style.display = 'block';
        logoutContainer.style.display = 'none';
        
        if(userNameEl) userNameEl.innerText = "مستخدم زائر";
        if(userEmailEl) userEmailEl.innerText = "سجل الدخول للمزامنة";
        if(userAvatarEl) userAvatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        
        if(unsubscribeVault) {
            unsubscribeVault();
            unsubscribeVault = null;
        }
        accounts = [];
        folders = ["عام"];
        setSyncLoader(false, true);
    }
});

// دوال القائمة الجانبية (السحب)
function safeToggleMenu(e) {
    if(e) e.stopPropagation();
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('sideMenuOverlay');
    
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        overlay.classList.remove('active');
    } else {
        const appPass = localStorage.getItem('appPass');
        if (appPass) {
            openPasswordModal("رمز القائمة", (v) => {
                if (v === appPass) {
                    menu.classList.add('open');
                    overlay.classList.add('active');
                    updateLockText(true);
                } else {
                    showToast("خطأ بالرمز");
                }
            });
        } else {
            menu.classList.add('open');
            overlay.classList.add('active');
            updateLockText(false);
        }
    }
}

function closeSideMenu() {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('sideMenuOverlay');
    if(menu) menu.classList.remove('open');
    if(overlay) overlay.classList.remove('active');
}

function updateLockText(hasLock) {
    const lockText = document.getElementById('lockMenuText');
    if(lockText) {
        lockText.innerText = (hasLock || localStorage.getItem('appPass')) ? "إلغاء قفل التطبيق" : "تعيين قفل للتطبيق";
    }
}

function startGoogleLogin() {
    closeSideMenu();
    showToast("جاري الاتصال بجوجل...");
    auth.signInWithPopup(provider).catch(error => {
        console.error(error);
        showToast("فشل الدخول");
    });
}

function handleGoogleLogout() {
    closeSideMenu();
    customConfirm("هل تريد تسجيل الخروج؟", () => {
        auth.signOut().then(() => {
            accounts = [];
            folders = ["عام"];
            renderVault();
            showToast("تم تسجيل الخروج");
        });
    });
}

function setSyncLoader(isSyncing, isError = false) { 
    const dot = document.getElementById('syncDot');
    if (dot) {
        if (isError) {
            dot.className = 'sync-dot error';
        } else {
            dot.className = isSyncing ? 'sync-dot syncing' : 'sync-dot synced';
        }
    }
}

function setupRealtimeListener(uid) {
    setSyncLoader(true);
    unsubscribeVault = db.collection('vaults').doc(uid).onSnapshot(docSnap => {
        if(docSnap.exists) {
            const data = docSnap.data();
            accounts = data.accounts || [];
            folders = data.folders || ["عام", "فيسبوك", "جوجل"];
        } else {
            accounts = [];
            folders = ["عام", "فيسبوك", "جوجل"];
            saveToCloud(); 
        }
        applySort(currentSort, false); 
        renderFoldersBar();
        setSyncLoader(false);
    }, error => {
        console.error(error);
        setSyncLoader(false, true);
        showToast("فشل جلب البيانات");
    });
}

function saveToCloud() {
    const user = auth.currentUser;
    if(user) {
        setSyncLoader(true);
        db.collection('vaults').doc(user.uid).set({
            accounts: accounts,
            folders: folders
        }).then(() => {
            setSyncLoader(false);
        }).catch(error => {
            console.error(error);
            setSyncLoader(false, true);
            showToast("حدث خطأ أثناء الحفظ");
        });
    }
}

function exportDataAuto() {
    closeSideMenu();
    const dataToSave = { accounts: accounts, folders: folders };
    const blob = new Blob([JSON.stringify(dataToSave)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "secrets_vault_backup.json";
    a.click();
}

function importDataWrapper(e) {
    closeSideMenu();
    const reader = new FileReader();
    reader.onload = (f) => {
        try {
            const imported = JSON.parse(f.target.result);
            const rawAccounts = Array.isArray(imported) ? imported : (imported.accounts || []);
            const newFolders = imported.folders || ["عام"];

            const seenCombinations = new Set(accounts.map(a => {
                const em = (a.email || "").trim().toLowerCase();
                const fol = a.folder || "عام";
                return `${em}|${fol}`;
            }));
            
            const cleanAccounts = [];

            rawAccounts.forEach(importedAcc => {
                const rawEmail = importedAcc.email || importedAcc.title || "مستورد";
                const emailLower = rawEmail.trim().toLowerCase();
                const folder = importedAcc.folder || "عام";
                const combo = `${emailLower}|${folder}`;

                if (!seenCombinations.has(combo)) {
                    seenCombinations.add(combo);
                    cleanAccounts.push({
                        id: importedAcc.id || Date.now() + Math.random(),
                        email: rawEmail,
                        pass: importedAcc.pass || "...",
                        folder: folder
                    });
                }
            });

            accounts = [...accounts, ...cleanAccounts];

            newFolders.forEach(f => {
                if(!folders.includes(f)) folders.push(f);
            });

            cleanAccounts.forEach(acc => {
                if (acc.folder && !folders.includes(acc.folder)) {
                    folders.push(acc.folder);
                }
            });

            saveToCloud();
            renderFoldersBar();
            applySort(currentSort);

            if (cleanAccounts.length === 0 && rawAccounts.length > 0) {
                showToast("الحسابات موجودة مسبقاً");
            } else {
                showToast("تم استعادة البيانات بنجاح");
            }
        } catch(err){
            showToast("ملف غير صالح");
        }
    };
    if(e.target.files.length > 0) {
        reader.readAsText(e.target.files[0]);
    }
}

function handleAppLockSettings() {
    closeSideMenu();
    const appPass = localStorage.getItem('appPass');
    if(appPass) {
        openPasswordModal("أدخل الرمز لإزالته", (v) => {
            if(v === appPass) { 
                localStorage.removeItem('appPass'); 
                showToast("تم إزالة القفل");
            }
            else showToast("خطأ في الرمز");
        });
    } else {
        openPasswordModal("تعيين رمز جديد", (v) => { 
            if(v) { 
                localStorage.setItem('appPass', v); 
                showToast("تم القفل");
            } 
        });
    }
}

function confirmDeleteAll() {
    closeSideMenu();
    customConfirm("حذف كل البيانات نهائياً؟", () => {
        accounts = []; folders = ["عام"];
        saveToCloud();
        showToast("تم تفريغ الخزنة");
    });
}

function pushHistory(type = 'modal') { 
    window.history.pushState({modal: type}, null, ''); 
}

function goBack() { 
    if(window.history.state) {
        window.history.back();
        return;
    }
    const overlays = document.querySelectorAll('.overlay');
    let visible = false;
    overlays.forEach(o => { 
        if(o.classList.contains('show')) { 
            o.classList.remove('show'); 
            setTimeout(()=>o.style.display='none',200); 
            visible=true; 
        } 
    });
    
    if(!visible && document.getElementById('vaultPage').style.display === 'flex') {
        document.getElementById('vaultPage').style.display = 'none';
    }
}

window.onpopstate = () => {
    const overlays = document.querySelectorAll('.overlay');
    let closedModal = false;
    overlays.forEach(o => {
        if(o.classList.contains('show')) {
            o.classList.remove('show');
            setTimeout(()=>o.style.display='none', 200);
            closedModal = true;
        }
    });
    if(!closedModal) {
        const vault = document.getElementById('vaultPage');
        if(vault && vault.style.display === 'flex') {
            vault.style.display = 'none';
        } else {
            closeSideMenu();
        }
    }
};

function showOverlay(id) {
    pushHistory();
    const el = document.getElementById(id);
    el.style.display = 'flex';
    el.offsetHeight; 
    el.classList.add('show');
}

function submitPassword() {
    const val = document.getElementById('globalPassInput').value;
    const cb = pendingCallback;
    goBack(); 
    if(cb) { setTimeout(() => { cb(val); }, 200); }
    pendingCallback = null;
}

// الإضافة مسموحة دائماً بدون قفل
function prepareSaveAccount() {
    if (!auth.currentUser) {
        showToast("اتصل بحساب جوجل من القائمة أولاً");
        return;
    }

    const email = document.getElementById('emailInput').value.trim();
    if (!email) {
        showToast("أدخل البيانات أولاً");
        return;
    }
    isMoveAction = false;
    openFolderSelectModal("حفظ في");
}

function saveAccount(targetFolder) {
    const email = document.getElementById('emailInput').value.trim();
    const pass = document.getElementById('passInput').value;
    
    const lowerEmail = email.toLowerCase();
    const isDuplicate = accounts.some(acc => 
        (acc.email || "").trim().toLowerCase() === lowerEmail && acc.folder === targetFolder
    );

    if (isDuplicate) {
        showToast("هذا الحساب موجود مسبقاً في هذا القسم");
        return;
    }

    accounts.unshift({ id: Date.now(), email, pass, folder: targetFolder });
    saveToCloud();
    document.getElementById('emailInput').value = '';
    document.getElementById('passInput').value = '';
    applySort(currentSort); 
    showToast("تم الحفظ بنجاح");
}

function renderFoldersBar() {
    const bar = document.getElementById('foldersBar');
    bar.innerHTML = '';
    let totalCount = accounts.length;
    
    const allChip = document.createElement('div');
    allChip.className = `chip ${activeFolder === 'All' ? 'active' : ''}`;
    allChip.innerText = `الكل (${totalCount})`;
    allChip.onclick = () => { activeFolder = 'All'; renderVault(); renderFoldersBar(); };
    bar.appendChild(allChip);
    
    folders.forEach(f => {
        let folderCount = accounts.filter(a => a.folder === f).length;
        const chip = document.createElement('div');
        chip.className = `chip ${activeFolder === f ? 'active' : ''}`;
        chip.innerText = `${f} (${folderCount})`;
        chip.onclick = () => { activeFolder = f; renderVault(); renderFoldersBar(); };
        chip.onmousedown = () => startFolderPress(f);
        chip.ontouchstart = () => startFolderPress(f);
        chip.ontouchmove = cancelPress;
        chip.onmouseup = cancelPress;
        chip.ontouchend = cancelPress;
        bar.appendChild(chip);
    });
    
    const addBtn = document.createElement('div');
    addBtn.className = 'chip add-folder';
    addBtn.innerText = '+ مجلد جديد';
    addBtn.onclick = () => openAddFolderModal();
    bar.appendChild(addBtn);
}

function renderVault() {
    const list = document.getElementById('vaultList');
    const searchVal = document.getElementById('searchInput').value ? document.getElementById('searchInput').value.toLowerCase() : '';
    list.innerHTML = '';
    let displayAccounts = accounts;
    if (activeFolder !== 'All') displayAccounts = displayAccounts.filter(acc => acc.folder === activeFolder);
    if(searchVal) displayAccounts = displayAccounts.filter(acc => (acc.email && acc.email.toLowerCase().includes(searchVal)) || (acc.pass && acc.pass.toLowerCase().includes(searchVal)));
    
    if(displayAccounts.length === 0) { 
        list.innerHTML = '<div style="text-align:center; padding:60px 20px; color:var(--text-3);"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3; margin-bottom:10px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><h3>لا توجد حسابات</h3></div>'; 
        return; 
    }
    
    displayAccounts.forEach(acc => {
        const card = document.createElement('div');
        card.className = `account-card ${selectedIds.has(acc.id) ? 'selected-card' : ''}`;
        card.setAttribute('data-id', acc.id);
        const displayName = acc.email || "بدون عنوان";
        
        let leftSide = '';
        if (isSelectionMode) {
            leftSide = `<div class="selection-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`;
        } else if (!searchVal && activeFolder !== 'All') {
            leftSide = `<div class="drag-handle-visible" onmousedown="initDrag(event)" ontouchstart="initDrag(event)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg></div>`;
        } else {
             leftSide = `<div class="card-favicon">${displayName[0].toUpperCase()}</div>`;
        }
        
        card.innerHTML = `
            ${leftSide}
            <div class="card-main" onclick="handleCardClick(event, ${acc.id})">
                <div class="card-email" 
                     onmousedown="startPress('email', ${acc.id})" ontouchstart="startPress('email', ${acc.id})" 
                     ontouchmove="cancelPress()"
                     onmouseup="cancelPress()" ontouchend="cancelPress()">
                    <span>${displayName}</span>
                </div>
                <div id="pass-${acc.id}" class="card-pass-pill hidden-pass"
                    onmousedown="startPress('pass', ${acc.id})" ontouchstart="startPress('pass', ${acc.id})" 
                    ontouchmove="cancelPress()"
                    onmouseup="cancelPress()" ontouchend="cancelPress()">••••••••</div>
            </div>
        `;
        list.appendChild(card);
    });
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    selectedIds.clear();
    const btn = document.getElementById('selectToggleBtn');
    const bottomBar = document.getElementById('bottomBar');
    if (isSelectionMode) {
        btn.classList.add('active');
        bottomBar.style.display = 'flex';
        document.getElementById('selectedCount').innerText = "محدد صفر";
    } else {
        btn.classList.remove('active');
        bottomBar.style.display = 'none';
    }
    renderVault();
}

// قفل وتحديث مباشر للحذف المتعدد
function deleteSelected() {
    if(selectedIds.size === 0) return;
    const appPass = localStorage.getItem('appPass');
    
    const doDelete = () => {
        customConfirm(`هل أنت متأكد من الحذف؟`, () => {
            accounts = accounts.filter(acc => !selectedIds.has(acc.id));
            saveToCloud();
            toggleSelectionMode(); 
            renderFoldersBar(); // تحديث الأرقام بالعداد
            showToast("تم الحذف");
        });
    };

    if (appPass) {
        openPasswordModal("أدخل الرمز للحذف", (v) => {
            if (v === appPass) doDelete();
            else showToast("رمز خاطئ");
        });
    } else {
        doDelete();
    }
}

function handleCardClick(e, id) {
    if (isSelectionMode) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        document.getElementById('selectedCount').innerText = selectedIds.size + " محدد";
        renderVault();
    } else {
        if(e.target.closest('.drag-handle-visible')) return;
        handlePassClick(id);
    }
}

function handlePassClick(id) {
    if(isLongPress) return;
    const el = document.getElementById(`pass-${id}`);
    const acc = accounts.find(a => a.id === id);
    if(el.classList.contains('hidden-pass')) {
         el.innerText = acc.pass || '...'; 
         el.classList.remove('hidden-pass');
         el.style.fontSize = "16px"; el.style.letterSpacing = "0";
    } else { 
        el.innerText = '••••••••'; 
        el.classList.add('hidden-pass'); 
        el.style.fontSize = "22px"; el.style.letterSpacing = "4px";
    }
}

function openFolderSelectModal(title) {
    showOverlay('folderSelectModal');
    document.getElementById('folderModalTitle').innerText = title;
    const listBody = document.getElementById('folderListModalBody');
    listBody.innerHTML = '';
    const addRow = document.createElement('div');
    addRow.className = 'move-folder-option';
    addRow.style.color = 'var(--primary)';
    addRow.innerHTML = '+ مجلد جديد';
    addRow.onclick = () => { goBack(); setTimeout(openAddFolderModal, 200); };
    listBody.appendChild(addRow);
    folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'move-folder-option';
        row.innerText = f;
        row.onclick = () => {
            goBack();
            if (isMoveAction) executeMove(f);
            else saveAccount(f);
        };
        listBody.appendChild(row);
    });
}

function openMoveModal() {
    if(selectedIds.size === 0) return;
    isMoveAction = true;
    openFolderSelectModal("نقل عناصر");
}

function executeMove(targetFolder) {
    accounts.forEach(acc => { if(selectedIds.has(acc.id)) acc.folder = targetFolder; });
    saveToCloud();
    toggleSelectionMode(); activeFolder = targetFolder;
    showToast("تم النقل");
}

function openAddFolderModal(renameTarget = null) {
    folderRenameTarget = renameTarget;
    document.getElementById('addFolderTitle').innerText = renameTarget ? "تعديل المجلد" : "مجلد جديد";
    const input = document.getElementById('folderNameInput');
    input.value = renameTarget || '';
    showOverlay('addFolderModal');
    input.focus();
}

function submitFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if(!name) return;
    if (folderRenameTarget) {
        const index = folders.indexOf(folderRenameTarget);
        if(index !== -1) folders[index] = name;
        accounts.forEach(acc => { if(acc.folder === folderRenameTarget) acc.folder = name; });
    } else {
        if(!folders.includes(name)) folders.push(name);
    }
    saveToCloud(); goBack();
}

function startFolderPress(f) {
    isLongPress = false;
    longPressTimer = setTimeout(() => { isLongPress = true; if(f!=='عام') openAddFolderModal(f); }, 600);
}

let draggingItem = null;
function initDrag(e) {
    if(isSelectionMode) return;
    const handle = e.target.closest('.drag-handle-visible');
    if(!handle) return;
    draggingItem = handle.closest('.account-card');
    const list = document.getElementById('vaultList');
    list.addEventListener('mousemove', onDragMove);
    list.addEventListener('touchmove', onDragMove, {passive: false});
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);
    draggingItem.classList.add('dragging');
    if(navigator.vibrate) navigator.vibrate(20);
}
function onDragMove(e) {
    if(!draggingItem) return;
    e.preventDefault();
    const list = document.getElementById('vaultList');
    let clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const siblings = [...list.querySelectorAll('.account-card:not(.dragging)')];
    let nextSibling = siblings.find(sibling => clientY <= sibling.getBoundingClientRect().top + sibling.offsetHeight / 2);
    list.insertBefore(draggingItem, nextSibling);
}
function onDragEnd() {
    if(!draggingItem) return;
    draggingItem.classList.remove('dragging');
    draggingItem = null;
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchend', onDragEnd);
    saveNewOrder();
}
function saveNewOrder() {
    const list = document.getElementById('vaultList');
    const cards = list.querySelectorAll('.account-card');
    const reorderedIds = [];
    cards.forEach(c => reorderedIds.push(Number(c.getAttribute('data-id'))));
    if(activeFolder !== 'All') {
        const folderItems = accounts.filter(a => a.folder === activeFolder);
        const sortedFolderItems = [];
        reorderedIds.forEach(id => {
            const item = folderItems.find(a => a.id === id);
            if(item) sortedFolderItems.push(item);
        });
        const otherItems = accounts.filter(a => a.folder !== activeFolder);
        accounts = [...sortedFolderItems, ...otherItems]; 
    } else {
         const newAccounts = [];
         reorderedIds.forEach(id => {
             const acc = accounts.find(a => a.id === id);
             if(acc) newAccounts.push(acc);
         });
         accounts = newAccounts;
    }
    saveToCloud();
}

function startPress(type, id) {
    isLongPress = false;
    longPressTimer = setTimeout(() => { isLongPress = true; openContextMenu(type, id); }, 800);
}
function cancelPress() { clearTimeout(longPressTimer); }

function openContextMenu(type, id) {
    currentCtxId = id; currentCtxType = type;
    showOverlay('contextModal');
    if (navigator.vibrate) navigator.vibrate(50);
}

// قفل وتحديث مباشر لخيارات التعديل والحذف
function ctxAction(action) {
    goBack();
    const acc = accounts.find(a => a.id === currentCtxId);
    const appPass = localStorage.getItem('appPass');
    
    setTimeout(() => {
        if (!acc) return;
        
        if (action === 'copy') {
            copyToClipboard(currentCtxType === 'email' ? acc.email : acc.pass);
        } 
        else if (action === 'delete') {
            const doDelete = () => {
                customConfirm("حذف نهائي؟", () => {
                    accounts = accounts.filter(a => a.id !== currentCtxId);
                    saveToCloud();
                    renderVault(); // تحديث فوري
                    renderFoldersBar(); // تحديث الأرقام
                    showToast("تم الحذف");
                });
            };

            if (appPass) {
                openPasswordModal("أدخل الرمز للحذف", (v) => {
                    if (v === appPass) doDelete();
                    else showToast("رمز خاطئ");
                });
            } else {
                doDelete();
            }
        } 
        else if (action === 'edit') {
            const doEdit = () => {
                document.getElementById('emailInput').value = acc.email;
                document.getElementById('passInput').value = acc.pass;
                accounts = accounts.filter(a => a.id !== currentCtxId);
                saveToCloud(); 
                renderVault(); // تحديث فوري
                renderFoldersBar();
                if(document.getElementById('vaultPage').style.display === 'flex') goBack();
            };

            if (appPass) {
                openPasswordModal("أدخل الرمز للتعديل", (v) => {
                    if (v === appPass) doEdit();
                    else showToast("رمز خاطئ");
                });
            } else {
                doEdit();
            }
        }
    }, 200);
}

function openPasswordModal(t, cb) {
    document.getElementById('passModalTitle').innerText = t;
    document.getElementById('globalPassInput').value = '';
    showOverlay('passwordModal');
    pendingCallback = cb;
    setTimeout(()=>document.getElementById('globalPassInput').focus(), 100);
}

function customConfirm(m, cb) {
    document.getElementById('confirmMessage').innerText = m;
    const btn = document.getElementById('confirmYesBtn');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.onclick = () => { goBack(); setTimeout(cb, 100); };
    showOverlay('confirmModal');
}

function startVaultPress() {
    isLongPress = false;
    vaultPressTimer = setTimeout(() => { isLongPress = true; handleVaultLongPress(); }, 800);
}
function cancelVaultPress() { clearTimeout(vaultPressTimer); }

function handleVaultLongPress() {
    const vp = localStorage.getItem('vaultPass');
    if(vp) openPasswordModal("إزالة قفل الخزنة", v => { 
        if(v===vp){ 
            localStorage.removeItem('vaultPass'); 
            showToast("تم الإلغاء"); 
        } else showToast("خطأ"); 
    });
    else openPasswordModal("قفل الخزنة", v => { 
        if(v){ 
            localStorage.setItem('vaultPass', v); 
            showToast("تم القفل");
        } 
    });
}

function openVaultCheck() {
    if(isLongPress) return;
    
    if (!auth.currentUser) {
        showToast("اتصل بحساب جوجل من القائمة أولاً");
        return;
    }

    const vp = localStorage.getItem('vaultPass');
    if(vp) openPasswordModal("رمز الخزنة", v => { if(v===vp) openVault(); else showToast("خطأ"); });
    else openVault();
}

function openVault() {
    pushHistory('vault');
    document.getElementById('vaultPage').style.display = 'flex';
    renderFoldersBar(); renderVault();
}

function pasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(t => {
            document.getElementById('importText').value = t;
        }).catch(err => {
            showToast("نظام الحماية منع الزر، استخدم الضغطة المطولة للصق");
        });
    } else {
        showToast("استخدم الضغطة المطولة للصق بهذا الجهاز");
    }
}

function copyToClipboard(t) { navigator.clipboard.writeText(t).then(()=>showToast("تم النسخ")); }
function showToast(m) { const t=document.getElementById('toast'); t.innerText=m; t.style.opacity='1'; setTimeout(()=>t.style.opacity='0',2000); }

function handleAndroidBack() {
    const openOverlay = document.querySelector('.overlay.show');
    if (openOverlay) {
        goBack(); 
        sendToKodular("STAY");
        return;
    }
    if (document.getElementById('vaultPage').style.display === 'flex') {
        document.getElementById('vaultPage').style.display = 'none';
        if(window.history.state) window.history.back();
        sendToKodular("STAY");
        return;
    }
    const sideMenu = document.getElementById('sideMenu');
    if (sideMenu && sideMenu.classList.contains('open')) {
        closeSideMenu();
        sendToKodular("STAY");
        return;
    }
    sendToKodular("EXIT");
}

function sendToKodular(message) {
    if (window.AppInventor && window.AppInventor.setWebViewString) {
        window.AppInventor.setWebViewString(message);
    }
}

// دالة الوضع الليلي بتصليح جذري
function toggleTheme() {
    const body = document.body;
    document.documentElement.removeAttribute('data-theme'); // مسح القيمة اللي كانت معلقة بالـ HTML
    
    body.classList.toggle('dark-theme');
    const isDark = body.classList.contains('dark-theme');
    
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) themeIcon.innerText = isDark ? "☀️" : "🌙";
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// قراءة الوضع الليلي المحفوظ أول ما يفتح التطبيق
document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.removeAttribute('data-theme'); // تنظيف إجباري
    const savedTheme = localStorage.getItem('theme');
    const themeIcon = document.getElementById('themeIcon');
    
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        if(themeIcon) themeIcon.innerText = "🌙";
    } else {
        // الافتراضي داكن إذا مافي شي محفوظ أو إذا محفوظ داكن
        document.body.classList.add('dark-theme');
        if(themeIcon) themeIcon.innerText = "☀️";
    }

    const vaultList = document.getElementById('vaultList');
    if (vaultList) {
        vaultList.addEventListener('scroll', cancelPress);
    }
});

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    renderVault();
}

document.getElementById('searchInput')?.addEventListener('input', function() {
    document.getElementById('clearSearchBtn').style.display = this.value ? 'block' : 'none';
});

function openSortModal() {
    showOverlay('sortModal');
    document.getElementById('check-newest').style.display = currentSort === 'newest' ? 'inline' : 'none';
    document.getElementById('check-oldest').style.display = currentSort === 'oldest' ? 'inline' : 'none';
    document.getElementById('check-az').style.display = currentSort === 'az' ? 'inline' : 'none';
}

function applySort(type, render = true) {
    currentSort = type;
    if(type === 'newest') accounts.sort((a,b) => b.id - a.id);
    if(type === 'oldest') accounts.sort((a,b) => a.id - b.id);
    if(type === 'az') accounts.sort((a,b) => (a.email||'').localeCompare(b.email||''));
    if (render) {
        renderVault();
        goBack();
    }
}