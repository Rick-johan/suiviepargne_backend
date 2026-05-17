const API_URL = '/api';

// Détection dynamique de l'URL pour que les liens marchent en local (Copier/Coller)
function getFrontBaseUrl() {
    const currentPath = window.location.href;
    if (currentPath.startsWith('file://')) {
        // En local : le client est dans le sous-dossier /suivi
        return currentPath.substring(0, currentPath.lastIndexOf('/')) + '/suivi';
    }
    // Sur un serveur (Netlify, etc.) : le client est dans /suivi
    return window.location.origin + '/suivi';
}

const FRONT_URL = getFrontBaseUrl();
let ADMIN_TOKEN = sessionStorage.getItem('admin_token');
let ALL_PROJECTS = [];
let currentTypeFilter = 'all';
let searchQuery = '';
let CURRENT_EDITING_ID = null;
let ALL_PENDING = [];

window.closeCreateModal = function () {
    const modal = document.getElementById('create-modal');
    if (modal) modal.classList.remove('active');
    const form = document.getElementById('create-form');
    if (form) form.reset();
    CURRENT_EDITING_ID = null;
    const title = document.getElementById('modal-title');
    if (title) title.innerText = "Nouveau Projet";
    const btn = document.getElementById('submit-btn');
    if (btn) { btn.innerText = "Générer le projet"; btn.disabled = false; }
}

window.openCreateModal = function () {
    CURRENT_EDITING_ID = null;
    const title = document.getElementById('modal-title');
    if (title) title.innerText = "Nouveau Projet";
    const form = document.getElementById('create-form');
    if (form) form.reset();
    const modal = document.getElementById('create-modal');
    if (modal) modal.classList.add('active');
}

window.openPasswordModal = function () { document.getElementById('password-modal').classList.add('active'); }
window.closePasswordModal = function () { document.getElementById('password-modal').classList.remove('active'); }
window.openMobileSettings = function () { document.getElementById('mobile-settings-modal').classList.add('active'); }
window.closeMobileSettings = function () { document.getElementById('mobile-settings-modal').classList.remove('active'); }

// Helper Dialog
function showDialog(title, msg, isPrompt, defaultValue, callback) {
    const overlay = document.getElementById('dialog-overlay');
    document.getElementById('dialog-title').innerText = title;
    document.getElementById('dialog-msg').innerText = msg;
    const input = document.getElementById('dialog-input');
    const btnCancel = document.getElementById('dialog-btn-cancel');
    const btnOk = document.getElementById('dialog-btn-ok');

    if (isPrompt) {
        input.style.display = 'block';
        input.value = defaultValue;
    } else {
        input.style.display = 'none';
    }

    overlay.classList.add('show');

    const newBtnCancel = btnCancel.cloneNode(true); btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    const newBtnOk = btnOk.cloneNode(true); btnOk.parentNode.replaceChild(newBtnOk, btnOk);

    newBtnCancel.onclick = () => { overlay.classList.remove('show'); };
    newBtnOk.onclick = () => {
        overlay.classList.remove('show');
        if (callback) callback(isPrompt ? input.value : true);
    };
}

async function handleLogin() {
    const password = document.getElementById('admin-pass').value;
    const errorEl = document.getElementById('login-error');

    try {
        const res = await fetch(`${API_URL}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            ADMIN_TOKEN = data.token;
            sessionStorage.setItem('admin_token', ADMIN_TOKEN);
            showStudio();
        } else {
            errorEl.style.display = 'block';
            errorEl.innerText = data.error;
        }
    } catch (err) {
        errorEl.style.display = 'block';
        errorEl.innerText = "Erreur de connexion au serveur.";
    }
}

function showStudio() {
    document.getElementById('login-overlay').style.display = 'none';
    document.querySelector('.studio-app').classList.add('active');
    loadProjects();
}

function handleLogout() {
    sessionStorage.removeItem('admin_token');
    window.location.reload();
}

function filterType(type, e) {
    currentTypeFilter = type;
    const eventObj = e || window.event;

    // Correctly switch visibility
    document.getElementById('projects-container').style.display = 'grid';
    document.getElementById('validation-section').style.display = 'none';
    document.getElementById('audit-section').style.display = 'none';

    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

    // Safety check for event target if user clicks on svg icon inside the button
    const targetLink = eventObj && eventObj.target ? (eventObj.target.closest ? eventObj.target.closest('a') : eventObj.target) : null;
    if (targetLink) targetLink.classList.add('active');

    renderProjects();
}

function handleSearch(isMobile = false) {
    const inputId = isMobile ? 'mobile-project-search' : 'project-search';
    searchQuery = document.getElementById(inputId).value.toLowerCase();

    // Keep inputs in sync if possible
    const otherId = isMobile ? 'project-search' : 'mobile-project-search';
    const otherInput = document.getElementById(otherId);
    if (otherInput) otherInput.value = document.getElementById(inputId).value;

    renderProjects();
}

async function loadProjects() {
    if (!ADMIN_TOKEN) return;
    const container = document.getElementById('projects-container');

    try {
        const res = await fetch(`${API_URL}/admin/projects`, {
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });

        if (res.status === 401) {
            sessionStorage.removeItem('admin_token');
            window.location.reload();
            return;
        }

        const body = await res.json();

        if (!res.ok) {
            container.innerHTML = `<div style="color:red">Erreur serveur: ${body.error || JSON.stringify(body)}</div>`;
            return;
        }

        ALL_PROJECTS = Array.isArray(body) ? body : [];
        renderProjects();
    } catch (err) {
        container.innerHTML = `<div style="color:red">Erreur de connexion: ${err.message}</div>`;
    }

    // Update pending count badge
    updatePendingBadge();
    startStudioPolling();
}

async function updatePendingBadge() {
    try {
        const res = await fetch(`${API_URL}/admin/pending-payments`, {
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });
        const data = await res.json();
        if (data.success) {
            ALL_PENDING = data.pendingPayments;
            const count = ALL_PENDING.length;

            // Sync all badges
            const badges = ['pending-badge', 'header-pending-badge'];
            badges.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = count > 0 ? 'inline-block' : 'none';
                    el.innerText = count;
                }
            });
        }
    } catch (e) { }
}

window.showSection = function (id) {
    document.getElementById('projects-container').style.display = (id === 'all') ? 'grid' : 'none';
    document.getElementById('validation-section').style.display = (id === 'validation') ? 'block' : 'none';
    document.getElementById('audit-section').style.display = (id === 'audit') ? 'block' : 'none';

    // Update Sidebar classes
    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    if (id === 'validation') {
        document.querySelector('[onclick="showSection(\'validation\')"]').classList.add('active');
        loadPendingPayments();
    } else if (id === 'audit') {
        document.querySelector('[onclick="showSection(\'audit\')"]').classList.add('active');
        loadAuditLogs();
    } else {
        const fallback = document.querySelector('[onclick="filterType(\'all\')"]');
        if (fallback) fallback.classList.add('active');
    }
}

window.updateMTab = function (element) {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
    element.classList.add('active');
}

window.showingAllHistory = false;
window.toggleAllHistory = function () {
    window.showingAllHistory = true;
    loadAuditLogs(true);
}

async function loadAuditLogs(skipFetch = false) {
    const list = document.getElementById('audit-list');
    if (!skipFetch) list.innerHTML = `<div style="text-align:center; padding:3rem;">Chargement de l'historique...</div>`;

    try {
        if (!skipFetch || !window.AUDIT_LOGS) {
            const res = await fetch(`${API_URL}/admin/audit-logs`, {
                headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
            });
            const data = await res.json();
            if (data.success) {
                const newDataStr = JSON.stringify(data.logs);
                if (skipFetch && window.lastAuditData === newDataStr) return;
                window.lastAuditData = newDataStr;
                window.AUDIT_LOGS = data.logs;
            } else throw new Error("Erreur");
        }

        const logsData = window.AUDIT_LOGS || [];

        if (logsData.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted)">Aucune opération récente.</div>`;
            return;
        }

        window.expandedProjectHistory = window.expandedProjectHistory || null;

        const grouped = {};
        logsData.forEach(log => {
            const pid = log.projectId || 'unknown';
            if (!grouped[pid]) grouped[pid] = { name: log.projectName || 'Projet Inconnu', logs: [] };
            grouped[pid].logs.push(log);
        });

        let html = '<div class="projects-grid">';
        for (const [pid, group] of Object.entries(grouped)) {
            const expanded = window.expandedProjectHistory === pid;
            const displayLogs = expanded ? group.logs : group.logs.slice(0, 10);

            let logsHtml = displayLogs.map(log => {
                const dateStr = new Date(log.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                const isApprove = log.action === 'approve';
                const isReject = log.action === 'reject';
                const isUndo = log.action === 'undo';

                let actionColor, actionText;
                if (isApprove) { actionColor = 'var(--brand)'; actionText = 'Validation'; }
                else if (isReject) { actionColor = '#e74c3c'; actionText = 'Rejet'; }
                else if (isUndo) { actionColor = '#f59e0b'; actionText = 'Annulé'; }

                const txInfo = log.transactionId ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">Wave: ${log.transactionId}</span>` : '';

                const undoBtn = (!isUndo) ? `<button onclick="confirmUndo('${log._id}', '${log.action}')" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; transition: transform 0.2s;" title="Annuler">↩️</button>` : '';
                const deleteBtn = `<button onclick="deleteAuditLog('${log._id}')" style="background:transparent; border:none; color:#e74c3c; cursor:pointer; font-size:1.1rem; transition: transform 0.2s; margin-left:8px;" title="Supprimer">🗑️</button>`;

                return `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--border);">
                    <div style="flex:1;">
                        <strong style="color:var(--text-main); font-size:0.95rem;">${log.memberName || 'Membre'}</strong>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Soum: ${dateStr}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">Semaines: <strong style="color:var(--text-main);">${(log.weekIds || []).join(', ')}</strong> ${txInfo}</div>
                    </div>
                    <div style="display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
                        <span style="font-size:0.75rem; font-weight:bold; color:${actionColor}; background:${actionColor}1A; padding:2px 6px; border-radius:8px; margin-right:8px; margin-bottom:4px;">${actionText}</span>
                        <div style="white-space:nowrap;">
                            ${undoBtn}
                            ${deleteBtn}
                        </div>
                    </div>
                </div>`;
            }).join('');

            const viewAllBtn = (!expanded && group.logs.length > 10) ? `<button class="btn btn-ghost" style="width:100%; margin-top:1rem; font-size:0.85rem;" onclick="window.expandedProjectHistory = '${pid}'; loadAuditLogs(true);">Voir tout (${group.logs.length})</button>` : '';
            const hideBtn = (expanded && group.logs.length > 10) ? `<button class="btn btn-ghost" style="width:100%; margin-top:1rem; font-size:0.85rem;" onclick="window.expandedProjectHistory = null; loadAuditLogs(true);">Réduire</button>` : '';

            html += `
            <div class="project-card">
                <div style="margin-bottom:15px; border-bottom:1px solid var(--border); padding-bottom:10px;">
                    <div style="display:inline-block; font-size:0.7rem; font-weight:bold; color:var(--brand); background:var(--brand)1A; padding:2px 6px; border-radius:4px; margin-bottom:8px;">PROJET</div>
                    <h3 style="color:var(--text-main); font-size:1.1rem;">${group.name}</h3>
                </div>
                <div>
                    ${logsHtml}
                </div>
                ${viewAllBtn}
                ${hideBtn}
            </div>
            `;
        }
        html += '</div>';

        const scrollContainer = document.querySelector('.content-scroll');
        const oldScroll = scrollContainer ? scrollContainer.scrollTop : 0;

        list.innerHTML = html;

        if (scrollContainer && skipFetch) scrollContainer.scrollTop = oldScroll;


    } catch (e) {
        list.innerHTML = `<div class="error-msg">Erreur de chargement de l'historique.</div>`;
    }
}

window.confirmUndo = function (logId, actionType) {
    const actionName = actionType === 'approve' ? 'Validation' : 'Rejet';
    showDialog("Studio Admin", `Voulez-vous vraiment ANNULER cette action de ${actionName} ?`, false, null, async () => {
        try {
            const res = await fetch(`${API_URL}/admin/audit-logs/undo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                body: JSON.stringify({ logId })
            });
            const data = await res.json();
            if (data.success) {
                // Toast notification
                const toast = document.createElement('div');
                toast.innerText = 'Action annulée avec succès';
                toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:var(--brand); color:#fff; padding:10px 24px; border-radius:30px; font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.2); z-index:9999; opacity:0; transition: opacity 0.3s ease;";
                document.body.appendChild(toast);
                setTimeout(() => toast.style.opacity = '1', 10);
                setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);

                loadAuditLogs();
                updatePendingBadge();
                if (document.getElementById('validation-section').style.display === 'block') {
                    loadPendingPayments();
                }
            } else {
                showDialog("Erreur", data.error, true);
            }
        } catch (e) {
            showDialog("Erreur", "Erreur réseau lors de l'annulation.", true);
        }
    });
}

let studioSyncInterval;
window.deleteAuditLog = function (logId) {
    showDialog("Suppression Définitive", `Voulez-vous DÉFINITIVEMENT effacer cet historique de la base ?`, false, null, async () => {
        try {
            const res = await fetch(`${API_URL}/admin/audit-logs/${logId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
            });
            const data = await res.json();
            if (data.success) {
                const toast = document.createElement('div');
                toast.innerText = 'Audit supprimé avec succès';
                toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#e74c3c; color:#fff; padding:10px 24px; border-radius:30px; font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.2); z-index:9999; opacity:0; transition: opacity 0.3s ease;";
                document.body.appendChild(toast);
                setTimeout(() => toast.style.opacity = '1', 10);
                setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);

                window.AUDIT_LOGS = null; // Force reload logic
                loadAuditLogs();
            } else {
                showDialog("Erreur", data.error, true);
            }
        } catch (e) {
            showDialog("Erreur", "Erreur réseau.", true);
        }
    });
}

function startStudioPolling() {
    if (studioSyncInterval) clearInterval(studioSyncInterval);
    studioSyncInterval = setInterval(() => {
        if (!ADMIN_TOKEN) return;

        // Refresh validation badge in background silently
        updatePendingBadge();

        // If we are looking at validations, refresh them cleanly
        if (document.getElementById('validation-section').style.display === 'block') {
            loadPendingPayments(true); // pass true to avoid resetting HTML and just map silently? 
            // the current loadPendingPayments rewrites HTML, we can just call it, it might flash lightly.
        }

        // If we are looking at audit logs, refresh them
        if (document.getElementById('audit-section').style.display === 'block') {
            loadAuditLogs(true);
        }
    }, 15000);
}

async function loadPendingPayments(silent = false) {
    const list = document.getElementById('pending-list');
    if (!silent) {
        list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem;">Chargement des attentes...</div>`;
    }

    try {
        const res = await fetch(`${API_URL}/admin/pending-payments`, {
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });
        const data = await res.json();
        if (data.success) {
            const newPendingStr = JSON.stringify(data.pendingPayments);
            if (silent && window.lastPendingData === newPendingStr) return;
            window.lastPendingData = newPendingStr;

            ALL_PENDING = data.pendingPayments;
            if (ALL_PENDING.length === 0) {
                list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted)">Aucun paiement en attente. ☕</div>`;
                return;
            }

            const scrollContainer = document.querySelector('.content-scroll');
            const oldScroll = scrollContainer ? scrollContainer.scrollTop : 0;

            list.innerHTML = ALL_PENDING.map(p => {
                const txInfo = p.transactionId ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px; padding:4px; background:var(--bg-app); border-radius:4px; border:1px solid var(--border);">ID Wave : <strong style="color:var(--text-main); letter-spacing:1px;">${p.transactionId}</strong></div>` : '';
                const dateStr = p.date ? new Date(p.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

                return `
                <div class="pending-card" id="card-${p.memberId}">
                    <div class="pending-card-header">
                        <div>
                            <div class="pending-user">${p.memberName}</div>
                            <div class="pending-project">${p.projectName} <span style="font-size:0.75rem; color:var(--text-muted)">- ${dateStr}</span></div>
                            ${txInfo}
                        </div>
                        <div style="font-size:1.5rem">⏳</div>
                    </div>
                    <div class="pending-weeks-list" style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${p.weekIds.map(w => `
                            <label class="pending-week-badge" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0;">
                                <input type="checkbox" value="${w}" checked class="week-checkbox-${p.memberId}"> Sem ${w}
                            </label>
                        `).join('')}
                    </div>
                    <div class="pending-card-actions" style="display:flex; gap:10px;">
                        <button class="btn btn-outline" style="flex:1; border-color:#e74c3c; color:#e74c3c" onclick="rejectPayment('${p.memberId}')">
                            Rejeter
                        </button>
                        <button class="btn btn-primary" style="flex:1" onclick="approvePayment('${p.memberId}')">
                            Valider
                        </button>
                    </div>
                </div>
            `}).join('');

            if (scrollContainer && silent) scrollContainer.scrollTop = oldScroll;
        }
    } catch (e) {
        list.innerHTML = `<div class="error-msg">Erreur de chargement.</div>`;
    }
}

window.approvePayment = async function (memberId) {
    const checkboxes = document.querySelectorAll(`.week-checkbox-${memberId}:checked`);
    const weekIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (weekIds.length === 0) return alert("Sélectionnez au moins une semaine à valider.");

    showDialog("Confirmation", `Valider DÉFINITIVEMENT ces ${weekIds.length} semaines ?`, false, null, async () => {
        try {
            const res = await fetch(`${API_URL}/admin/approve-payment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ADMIN_TOKEN}`
                },
                body: JSON.stringify({ memberId, weekIds })
            });
            const data = await res.json();
            if (data.success) {
                loadPendingPayments();
                updatePendingBadge();
            }
        } catch (e) {
            alert("Erreur lors de l'approbation.");
        }
    });
}

window.rejectPayment = async function (memberId) {
    const checkboxes = document.querySelectorAll(`.week-checkbox-${memberId}:checked`);
    const weekIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (weekIds.length === 0) return alert("Sélectionnez au moins une semaine à rejeter.");

    showDialog("Confirmation Rejet", `Voulez-vous ANNULER la demande pour ces ${weekIds.length} semaines ? Elles redeviendront impayées.`, false, null, async () => {
        try {
            const res = await fetch(`${API_URL}/admin/reject-payment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ADMIN_TOKEN}`
                },
                body: JSON.stringify({ memberId, weekIds })
            });
            const data = await res.json();
            if (data.success) {
                loadPendingPayments();
                updatePendingBadge();
            }
        } catch (e) {
            alert("Erreur lors du rejet.");
        }
    });
}

function renderProjects() {
    const container = document.getElementById('projects-container');

    // Filtrage
    const filtered = ALL_PROJECTS.filter(p => {
        const matchesType = currentTypeFilter === 'all' || p.type.toLowerCase() === currentTypeFilter;
        const matchesSearch = p.name.toLowerCase().includes(searchQuery) || p.slug.toLowerCase().includes(searchQuery);
        return matchesType && matchesSearch;
    });

    // Stats Globales
    let globalSaved = 0;
    let globalMembers = 0;
    ALL_PROJECTS.forEach(p => {
        globalSaved += p.stats.totalSaved;
        globalMembers += p.stats.memberCount;
    });

    document.getElementById('global-saved').innerText = globalSaved.toLocaleString() + " F";
    document.getElementById('global-projects').innerText = ALL_PROJECTS.length;
    document.getElementById('global-members').innerText = globalMembers;

    container.innerHTML = filtered.map(p => {
        const displayName = p.name.replace(/_/g, ' ');

        let descriptorText = "";
        if (p.savingMode === 'target_objective') {
            descriptorText = `Épargne Objective: ${p.stats.totalTarget.toLocaleString()} F`;
        } else if (p.savingMode === 'fixed_constant') {
            descriptorText = `Épargne Constante: ${p.baseAmount.toLocaleString()} F / base`;
        } else {
            descriptorText = `Épargne Progressive: x${p.baseAmount.toLocaleString()} F`;
        }

        return `
            <div class="project-card">
                <div class="project-info">
                    <span class="badge ${p.type === 'Groupe' ? 'group' : 'solo'}">${p.type.toUpperCase()}</span>
                    <h3 style="color:var(--text-main)">${displayName}</h3>
                    <p style="color:var(--text-muted); font-size:0.85rem;">${descriptorText}</p>
                </div>

                <div class="members-list">
                    ${p.memberDetails.map(m => `
                        <div style="display:flex; justify-content:space-between; font-size:0.75rem; background:var(--bg-app); padding:6px 10px; border-radius:8px; border:1px solid var(--border); align-items:center;">
                            <div style="display:flex; flex-direction:column;">
                                <strong style="color:var(--text-main)">${m.name}</strong>
                                <small style="color:var(--text-muted)">${m.count}/${p.stats.totalProgressCount} périodes</small>
                            </div>
                            <div style="text-align:right">
                                <span style="display:block; font-weight:700; color:var(--brand)">${m.total.toLocaleString()} F</span>
                                <small style="color:var(--text-muted)">sur ${m.target.toLocaleString()} F</small>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="progress-preview" style="padding-top:12px; border-top:1px dashed var(--border); margin-top:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
                        <div>
                            <span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Bilan Projet</span>
                            <strong style="display:block; font-size:1.1rem; color:var(--brand);">${p.stats.totalSaved.toLocaleString()} F</strong>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:0.7rem; color:var(--text-muted);">Objectif final</span>
                            <strong style="display:block; font-size:0.9rem; color:var(--text-muted);">${p.stats.totalTarget.toLocaleString()} F</strong>
                        </div>
                    </div>
                    <div style="height:8px; background:var(--bg-app); border-radius:5px; overflow:hidden; border:1px solid var(--border);">
                        <div style="width:${p.stats.percent}%; height:100%; background:linear-gradient(90deg, var(--brand), #4f46e5); border-radius:5px;"></div>
                    </div>
                    <div style="text-align:center; margin-top:6px; font-size:0.75rem; font-weight:700; color:var(--brand)">
                        ${p.stats.percent}% complété
                    </div>
                </div>

                <div class="project-actions">
                    <button class="btn btn-outline" style="flex:1" onclick="openDemo('${p.slug}')">Démo Cli</button>
                    <button class="btn btn-primary" style="flex:1" onclick="copyLink('${p.slug}')">Lien</button>
                    <button class="btn-icon" title="Modifier" onclick="editProject('${p.id}')">
                         <svg width="18" height="18" fill="none" stroke="currentColor"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="btn-icon" title="Supprimer" onclick="askDelete('${p.id}', '${p.name}')">
                        <svg width="18" height="18" fill="none" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleSidebar = function () {
    const sidebar = document.getElementById('studio-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;

    sidebar.classList.toggle('open');
    if (sidebar.classList.contains('open')) overlay.classList.add('active');
    else overlay.classList.remove('active');
}

// Modals
window.openCreateModal = function () {
    CURRENT_EDITING_ID = null; // Nouveau projet
    document.getElementById('modal-title').innerText = "Nouveau Suivi d'Épargne";
    document.getElementById('submit-btn').innerText = "Générer le projet";
    document.getElementById('create-form').reset();

    let now = new Date();
    let y = now.getFullYear();
    let m = (now.getMonth() + 1).toString().padStart(2, '0');
    let d = now.getDate().toString().padStart(2, '0');

    document.getElementById('p-start-date').value = `${y}-${m}-${d}`;
    document.getElementById('p-end-date').value = `${y + 1}-${m}-${d}`;

    handleModeChange(); // Reset visibilité champs
    document.getElementById('create-modal').classList.add('active');
}

window.editProject = function (id) {
    const p = ALL_PROJECTS.find(proj => proj.id === id);
    if (!p) return;

    CURRENT_EDITING_ID = id;
    document.getElementById('modal-title').innerText = "Modifier le Projet";
    document.getElementById('submit-btn').innerText = "Enregistrer les modifications";

    // Remplir les champs
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-slug').value = p.slug;
    document.getElementById('p-saving-mode').value = p.savingMode;
    document.getElementById('p-type').value = p.type;
    document.getElementById('p-base-amount').value = p.baseAmount;
    document.getElementById('p-target-amount').value = p.targetAmount;

    // Dates (Format YYYY-MM-DD pour input date)
    const sd = new Date(p.startDate).toISOString().split('T')[0];
    const ed = new Date(p.endDate).toISOString().split('T')[0];
    document.getElementById('p-start-date').value = sd;
    document.getElementById('p-end-date').value = ed;

    document.getElementById('p-billing-cycle').value = p.billingCycle;

    // Day logic
    if (p.billingCycle === 'monthly') {
        document.getElementById('p-billing-day-monthly').value = p.billingDay;
    } else {
        document.getElementById('p-billing-day-weekly').value = p.billingDay;
    }

    const memberNames = p.memberNames || [];
    document.getElementById('p-members').value = memberNames.join(', ');

    handleModeChange();
    handleCycleChange();
    document.getElementById('create-modal').classList.add('active');
}

window.closeCreateModal = function () {
    const modal = document.getElementById('create-modal');
    if (modal) modal.classList.remove('active');

    const form = document.getElementById('create-form');
    if (form) form.reset();

    CURRENT_EDITING_ID = null;
    const title = document.getElementById('modal-title');
    if (title) title.innerText = "Nouveau Projet";

    const btn = document.getElementById('submit-btn');
    if (btn) {
        btn.innerText = "Générer le projet";
        btn.disabled = false;
    }
}

document.getElementById('create-modal').addEventListener('click', (e) => {
    if (e.target.id === 'create-modal') closeCreateModal();
});

window.handleModeChange = function () {
    const mode = document.getElementById('p-saving-mode').value;
    const baseGrp = document.getElementById('base-amount-group');
    const targetGrp = document.getElementById('target-amount-group');
    const freqRow = document.getElementById('frequency-row');

    if (mode === 'target_objective') {
        baseGrp.style.display = 'none';
        targetGrp.style.display = 'block';
        freqRow.style.display = 'flex';
    } else {
        baseGrp.style.display = 'block';
        targetGrp.style.display = 'none';
        freqRow.style.display = 'none';
    }
}

window.handleCycleChange = function () {
    const cycle = document.getElementById('p-billing-cycle').value;
    if (cycle === 'monthly') {
        document.getElementById('billing-day-weekly-group').style.display = 'none';
        document.getElementById('billing-day-monthly-group').style.display = 'block';
    } else {
        document.getElementById('billing-day-weekly-group').style.display = 'block';
        document.getElementById('billing-day-monthly-group').style.display = 'none';
    }
}

// Slug auto-generation
document.getElementById('p-name').addEventListener('input', (e) => {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    document.getElementById('p-slug').value = slug;
});

// Création d'un Projet SaaS
async function handleCreate(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.innerText = "Génération..."; btn.disabled = true;

    const savingMode = document.getElementById('p-saving-mode').value;
    const billingCycle = document.getElementById('p-billing-cycle').value;
    const isMonthly = billingCycle === 'monthly';
    const billingDay = isMonthly ? parseInt(document.getElementById('p-billing-day-monthly').value) : parseInt(document.getElementById('p-billing-day-weekly').value);

    const payload = {
        name: document.getElementById('p-name').value,
        slug: document.getElementById('p-slug').value,
        type: document.getElementById('p-type').value,
        savingMode: savingMode,
        baseAmount: parseInt(document.getElementById('p-base-amount').value) || 0,
        targetAmount: parseInt(document.getElementById('p-target-amount').value) || 0,
        startDate: document.getElementById('p-start-date').value,
        endDate: document.getElementById('p-end-date').value,
        billingCycle: billingCycle,
        billingDay: billingDay,
        memberNames: document.getElementById('p-members').value.split(',').map(s => s.trim()).filter(s => s)
    };

    const url = CURRENT_EDITING_ID ? `${API_URL}/admin/projects/${CURRENT_EDITING_ID}` : `${API_URL}/admin/projects`;
    const method = CURRENT_EDITING_ID ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            const msg = CURRENT_EDITING_ID ? "Projet mis à jour avec succès !" : "Nouveau projet créé avec brio !";
            showDialog("Succès", msg, false, null, () => {
                location.reload();
            });
        } else {
            showDialog("Erreur", data.error || "Impossible de créer le projet.", false, null, () => {
                btn.innerText = "Générer"; btn.disabled = false;
            });
        }
    } catch (err) {
        showDialog("Erreur Serveur", "Le backend ne répond pas.", false, null, () => {
            btn.innerText = "Générer"; btn.disabled = false;
        });
    }
}

function copyLink(slug) {
    const link = `${FRONT_URL}/index.html?project=${slug}`;
    navigator.clipboard.writeText(link);
    showDialog("Lien Copié", "Le lien client a été placé dans votre presse-papier.", false, null, () => { });
}

function openDemo(slug) {
    const link = `${FRONT_URL}/index.html?project=${slug}`;
    window.open(link, '_blank');
}

function askDelete(id, name) {
    showDialog("Supprimer ?", `Voulez-vous vraiment supprimer le projet "${name}" ? Cette action est irréversible.`, false, null, async (confirmed) => {
        if (confirmed) {
            try {
                const res = await fetch(`${API_URL}/admin/projects/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
                });
                const data = await res.json();
                if (data.success) {
                    loadProjects();
                }
            } catch (err) {
                showDialog("Erreur", "Impossible de supprimer.", false, null, () => { });
            }
        }
    });
}

if (ADMIN_TOKEN) {
    showStudio();
}
/* --- STUDIO THEME & SECURITY LOGIC --- */

window.toggleStudioTheme = function () {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('studio_theme', isDark ? 'dark' : 'light');
    updateStudioThemeIcon(isDark);
}

function updateStudioThemeIcon(isDark) {
    const ids = ['theme-icon', 'mobile-theme-icon'];
    const path = isDark
        ? '<path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round"/>';

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = path;
    });
}

// Initial Theme Check
const savedTheme = localStorage.getItem('studio_theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    updateStudioThemeIcon(true);
}



window.handleUpdatePassword = async function (e) {
    e.preventDefault();
    const newPass = document.getElementById('new-admin-pass').value;
    const btn = document.getElementById('pass-submit-btn');

    if (newPass.length < 4) return alert("Mot de passe trop court.");

    btn.innerText = "Échange..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/admin/update-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify({ newPassword: newPass })
        });
        const data = await res.json();
        if (data.success) {
            showDialog("Succès", "Mot de passe Administrateur mis à jour !", false, null, () => {
                closePasswordModal();
                btn.innerText = "Sauvegarder"; btn.disabled = false;
            });
        } else {
            alert(data.error);
            btn.innerText = "Sauvegarder"; btn.disabled = false;
        }
    } catch (err) {
        alert("Erreur serveur");
        btn.innerText = "Sauvegarder"; btn.disabled = false;
    }
}
