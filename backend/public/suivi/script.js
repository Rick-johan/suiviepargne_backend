// Diagnostic Global pour Mobile
window.onerror = function (msg, url, line, col, error) {
    const errorMsg = `Erreur: ${msg} \nLieu: ${line}:${col} \nNavigateur: ${navigator.userAgent}`;
    console.error(errorMsg);
    // Affichage visuel pour les mobiles sans console
    const debugBox = document.getElementById('mobile-debug-alert');
    if (debugBox) {
        debugBox.style.display = 'block';
        debugBox.innerText = errorMsg;
    } else {
        alert("Une erreur est survenue sur ce mobile :\n" + errorMsg);
    }
    return false;
};

window.onunhandledrejection = function (event) {
    alert("Erreur Promesse: " + event.reason);
};

// Le calendrier est désormais généré dynamiquement par le Backend V2
let smartSchedule = { calendar: [], scheduleList: [], unitTarget: 0, collectiveTarget: 0 };

const API_URL = '/api';
const projectParams = new URLSearchParams(window.location.search);
const projectSlug = projectParams.get('project');

let checkedStates = {};
let pendingStates = {};
let selectedCheckoutWeeks = new Set();
let baseAmount = 100;
let members = [];
let currentMember = null;
let currentProject = null;
const targetTotal = () => smartSchedule.unitTarget;
let currentFilter = 'all';
let idleTimer; // Security Watchdog

function getMemberColor(member) {
    if (member && member.color) return member.color;
    const name = (typeof member === 'string') ? member : (member ? member.name : "System");
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#f97316', '#06b6d4'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

async function init() {
    if (!projectSlug) {
        document.body.innerHTML = "<h2 style='text-align:center; padding:2rem;'>Lien invalide. Aucun projet spécifié dans l'URL.</h2>";
        return;
    }

    try {
        const res = await fetch(`${API_URL}/p/${projectSlug}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentProject = data.project;
        members = data.members;
        smartSchedule = data.smartSchedule;
        baseAmount = currentProject.baseAmount;

        document.getElementById('app-title').innerText = currentProject.name;
        document.getElementById('login-project-title').innerText = currentProject.name;

        // Session Restoration Logic
        const savedSession = localStorage.getItem(`session_${projectSlug}`);
        if (savedSession) {
            const { id } = JSON.parse(savedSession);
            // Quick validation for auto-login
            const m = members.find(m => m.id === id);
            if (m) {
                checkedStates = m.checkedStates || {};
                pendingStates = m.pendingStates || {};
                finishLogin(id, m.name, m.pin);
            } else {
                renderLoginMembers();
            }
        } else {
            renderLoginMembers();
        }
    } catch (err) {
        document.body.innerHTML = `<h2 style='text-align:center; padding:2rem; color:red;'>${err.message || 'Erreur de chargement.'}</h2>`;
    }
}

function renderLoginMembers() {
    document.getElementById('login-screen').style.display = "flex";
    const list = document.getElementById('login-members-list');

    // Auto-scaling logic based on member count
    let sizingClass = "size-normal";
    if (members.length > 12) sizingClass = "size-tiny";
    else if (members.length > 6) sizingClass = "size-compact";

    list.className = "login-grid " + sizingClass;

    list.innerHTML = members.map(m => {
        // Victory Detection for Login Screen
        const totalPossible = (smartSchedule.scheduleList || []).length;
        const mStates = m.checkedStates || {};
        let mCount = 0;
        (smartSchedule.scheduleList || []).forEach(w => { if (mStates[w.id]) mCount++; });
        const isWinner = (totalPossible > 0 && mCount >= totalPossible);

        return `
            <div class="member-card ${isWinner ? 'is-winner' : ''}" onclick="attemptLogin('${m.id}', '${m.name}', ${m.isFirstLogin})">
                <div class="member-avatar" style="background:${getMemberColor(m)}">
                    ${m.name.charAt(0).toUpperCase()}
                </div>
                <div class="member-info">
                    <div class="member-name" style="display:flex; align-items:center; gap:5px;">
                        ${m.name}
                        ${isWinner ? '<span class="trophy-icon" title="Champion 52/52">🏆</span>' : ''}
                    </div>
                    <div class="member-subtitle" style="font-size:0.75rem; color:var(--text-muted)">
                        ${isWinner ? '<span class="badge-win">Challenge Terminé</span>' : 'Espace personnel'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.attemptLogin = function (id, name, isFirstLogin) {
    if (isFirstLogin) {
        showDialog("Configuration Sécurité", `Bienvenue ${name}. Créez votre NOUVEAU code PIN secret (4 chiffres) :`, true, "", async (newPin) => {
            if (newPin.length !== 4) return showDialog("Erreur", "Le PIN doit faire exactement 4 chiffres.", false, null, () => { });
            const res = await fetch(`${API_URL}/auth/update-pin`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberId: id, currentPin: "0000", newPin })
            });
            const data = await res.json();
            if (data.success) {
                showDialog("Succès", "Code PIN enregistré avec succès ! Bienvenue.", false, null, () => {
                    finishLogin(id, name, newPin);
                });
            } else {
                showDialog("Accès Refusé", data.error, false, null, () => { });
            }
        });
    } else {
        showDialog("Sécurité", `Bonjour ${name}, veuillez entrer votre Code PIN à 4 chiffres :`, true, "", async (pin) => {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberId: id, pin })
            });
            const data = await res.json();
            if (data.success) {
                // Si le serveur nous dit que c'est un reset (ex: Master PIN utilisé)
                if (data.isFirstLogin) {
                    showDialog("Réinitialisation Sécurisée", `Le code Master a été utilisé. Pour la sécurité de votre compte, veuillez créer un NOUVEAU code PIN (4 chiffres) :`, true, "", async (newPin) => {
                        if (newPin.length !== 4) return showDialog("Erreur", "Le PIN doit faire exactement 4 chiffres.", false, null, () => { });
                        const res2 = await fetch(`${API_URL}/auth/update-pin`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ memberId: id, currentPin: pin, newPin })
                        });
                        const data2 = await res2.json();
                        if (data2.success) {
                            showDialog("Succès", "Nouveau code PIN enregistré ! Bienvenue.", false, null, () => {
                                finishLogin(id, name, newPin);
                            });
                        } else {
                            showDialog("Erreur", data2.error, false, null, () => { });
                        }
                    });
                } else {
                    finishLogin(id, name, pin);
                }
            } else {
                showDialog("Erreur", data.error, false, null, () => { });
            }
        });
    }
}

function finishLogin(id, name, pin) {
    const memberData = members.find(m => m.id === id);
    currentMember = { id, name, pin, color: memberData.color };
    checkedStates = memberData.checkedStates || {};
    pendingStates = memberData.pendingStates || {};

    // Persist Session
    localStorage.setItem(`session_${projectSlug}`, JSON.stringify(currentMember));

    document.getElementById('login-screen').style.display = "none";
    document.getElementById('main-app').style.display = "block";

    // Update header avatar
    const color = getMemberColor(currentMember);
    const badge = document.getElementById('current-user-badge');
    badge.style.cursor = 'pointer';
    badge.onclick = () => openSettings();
    badge.innerHTML = `
        <div class="user-avatar-circle" style="background:${color}">${name.charAt(0).toUpperCase()}</div>
        <span id="current-user-name" class="desktop-only">${name}</span>
    `;

    // Security: Start Inactivity Watchdog
    resetIdleTimer();

    // Désactiver pour les membres simples des boutons globaux
    const settingsBtn = document.querySelector('.header-actions button[title="Paramètres"]');
    if (settingsBtn) settingsBtn.style.display = 'none';
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
            <span class="desktop-only">Déconnexion</span>
        `;
        resetBtn.style.display = 'flex';
        resetBtn.style.alignItems = 'center';
        resetBtn.onclick = logout;
    }

    renderMonths();
    renderHistory();
    updateDashboard();
    startPolling();
}

function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (currentMember) {
        // 2 Minutes = 120,000ms
        idleTimer = setTimeout(() => {
            console.log("Session expiré : Inactivité prolongée.");
            logout();
        }, 120000);
    }
}

function logout() {
    clearTimeout(idleTimer);
    localStorage.removeItem(`session_${projectSlug}`);
    currentMember = null;
    checkedStates = {};
    document.getElementById('main-app').style.display = "none";
    renderLoginMembers();
}

// Global Activity Listeners
['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, true);
});

// Navigation
window.switchTab = function (id) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(`tab-${id}`);
    const btn = document.querySelector(`[data-tab="${id}"]`);
    if (target) target.classList.add('active');
    if (btn) btn.classList.add('active');

    if (id === 'stats') updateDashboard();
    if (id === 'historique') renderHistory();
    if (id === 'defi') renderMonths();
    if (id === 'payments') renderCheckout();
};

// UI Elements
function renderMonths() {
    const grid = document.getElementById('months-grid');
    grid.innerHTML = '';

    if (!smartSchedule || !smartSchedule.calendar) return;

    smartSchedule.calendar.forEach(m => {
        const card = document.createElement('div');
        card.className = 'month-card';
        let monthIds = m.weeks.map(w => w.id);
        let monthTarget = 0;
        let myMonthPaid = 0;
        let groupMonthPaid = 0;

        const list = m.weeks.map(w => {
            const id = w.id;
            const val = w.amount;
            monthTarget += val;

            // Logique de Groupe : Vérifier qui a payé
            let weekGroupPaid = 0;
            let groupPayCount = 0;
            members.forEach(member => {
                if (member.id === currentMember.id) {
                    member.checkedStates = checkedStates; // Sync current state
                }
                const mStates = member.checkedStates || {};
                if (mStates[id]) {
                    groupPayCount++;
                    weekGroupPaid += val;
                }
            });

            groupMonthPaid += weekGroupPaid;
            if (checkedStates[id]) myMonthPaid += val;

            const isFullyChecked = (groupPayCount === members.length);
            const isMeChecked = checkedStates[id];
            const isMePending = pendingStates[id];

            return `
                <div class="week-item ${isMeChecked ? 'checked' : ''} ${isMePending ? 'pending' : ''} ${isFullyChecked ? 'fully-paid' : ''}" onclick="toggle(${id})">
                    <div class="check-box">
                        ${isFullyChecked ? '<svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' : ''}
                        ${!isFullyChecked && isMePending ? '<svg viewBox="0 0 24 24" fill="#f59e0b" width="12" height="12"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : ''}
                    </div>
                    <div style="flex:1">
                        <span class="week-label">${w.label}</span>
                        ${members.length > 1 ? `
                        <div class="group-dots">
                             ${members.map(m => {
                const color = getMemberColor(m);
                const isChecked = (m.id === currentMember.id) ? checkedStates[id] : (m.checkedStates && m.checkedStates[id]);
                const isPending = (m.id === currentMember.id) ? pendingStates[id] : (m.pendingStates && m.pendingStates[id]);

                return `<span class="member-initial ${isChecked ? 'active' : ''} ${isPending ? 'pending' : ''}" 
                                               style="${isChecked ? `--member-color:${color}` : ''}" 
                                               title="${m.name} ${isPending ? '(En attente)' : ''}">
                                            ${m.name.substring(0, 2).toUpperCase()}
                                         </span>`;
            }).join('')}
                        </div>` : ''}
                    </div>
                    <span class="week-amount">${val.toLocaleString()} F</span>
                </div>
            `;
        }).join('');

        const isMeDone = myMonthPaid >= monthTarget;


        // Refined calculation for member dots in summary
        let allMembersDone = true;
        const groupDotsHtml = (members || []).map(m => {
            const states = (m.id === currentMember.id ? checkedStates : m.checkedStates) || {};
            let mMonthPaid = 0;
            const mMonthIds = monthIds || [];

            mMonthIds.forEach(id => {
                const week = (smartSchedule.scheduleList || []).find(w => w.id === id);
                if (week && states[id]) mMonthPaid += week.amount;
            });
            const isDone = mMonthPaid >= monthTarget;
            if (!isDone) allMembersDone = false;

            const color = getMemberColor(m);
            return `<span class="member-initial ${isDone ? 'active' : ''}" 
                          style="${isDone ? `--member-color:${color}` : ''}" 
                          title="${m.name}: ${mMonthPaid}/${monthTarget}F">
                        ${m.name.substring(0, 2).toUpperCase()}
                    </span>`;
        }).join('');

        const isGroupDone = allMembersDone;

        if (isMeDone) card.classList.add('is-done');
        if (isGroupDone) card.classList.add('group-done');

        card.innerHTML = `
            <div class="month-header">
                <h3>${m.month}</h3>
                <button class="btn-ghost" onclick="markAll([${monthIds}])">Valider tout</button>
            </div>
            <div class="weeks-list">
                ${list}
            </div>
            <div class="month-summary">
                <div class="summary-row ${isMeDone ? 'is-done' : ''}">
                    <div class="check-box">
                        ${isMeDone ? '<svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' : ''}
                    </div>
                    <div style="flex:1">
                        <span class="label">MON BILAN MENSUEL</span>
                        <div class="group-dots">
                             <span class="member-initial ${isMeDone ? 'active' : ''}" 
                                   style="${isMeDone ? `--member-color:${getMemberColor(currentMember)}` : ''}">
                                ${currentMember.name.substring(0, 2).toUpperCase()}
                             </span>
                        </div>
                    </div>
                    <span class="val">${myMonthPaid.toLocaleString()} / ${monthTarget.toLocaleString()} F</span>
                </div>
                
                ${members.length > 1 ? `
                <div class="summary-row group ${isGroupDone ? 'is-done' : ''}">
                    <div class="check-box">
                        ${isGroupDone ? '<svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' : ''}
                    </div>
                    <div style="flex:1">
                        <span class="label">BILAN COLLECTIF</span>
                        <div class="group-dots">
                             ${groupDotsHtml}
                        </div>
                    </div>
                    <span class="val">${groupMonthPaid.toLocaleString()} F</span>
                </div>
                ` : ''}
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';
    let idx = 1;

    const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    const pendingIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

    if (!smartSchedule || !smartSchedule.scheduleList) return;

    smartSchedule.scheduleList.forEach(item => {
        const id = item.id;
        const checked = checkedStates[id];
        if (currentFilter === 'done' && !checked) return;
        if (currentFilter === 'pending' && checked) return;

        const amount = item.amount;
        const dt = new Date(item.date);
        const dateStr = dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        const isPending = pendingStates[id];
        const statusClass = checked ? 'done' : (isPending ? 'pending' : '');
        const statusText = checked ? 'Validé' : (isPending ? 'En attente' : 'À venir');

        const historyEl = document.createElement('div');
        historyEl.className = 'history-item';
        historyEl.innerHTML = `
                <div class="history-info">
                    <span class="history-date">${dateStr}</span>
                    <span class="history-meta">Versement #${id}</span>
                </div>
                <div class="history-actions">
                    <span class="history-amount">${amount.toLocaleString()} F</span>
                    <span class="status-badge ${statusClass}">
                        ${checked ? checkIcon : pendingIcon}
                        ${statusText}
                    </span>
                    ${(!checked && !isPending) ? `<button class="btn-action-sm cocher" onclick="toggle(${id})">Cocher</button>` : ''}
                </div>
            `;
        list.appendChild(historyEl);
    });
}


// Logic

window.markAll = function (ids) {
    if (!currentMember) return;
    const hasUnchecked = ids.some(id => !checkedStates[id] && !pendingStates[id]);
    const newState = hasUnchecked;
    const action = newState ? "Valider" : "Décocher";
    const weeksLabel = ids.length > 3 ? `${ids.length} semaines` : `les semaines ${ids.join(', ')}`;

    // If Unchecking (Admin or correction)
    if (!newState) {
        showDialog("Sécurité", `Pour Décocher ${weeksLabel}, confirmez avec votre PIN :`, true, "", async (pin) => {
            // Optimistic UI updates
            ids.forEach(id => checkedStates[id] = false);
            renderMonths(); renderHistory(); updateDashboard();

            try {
                const promises = ids.map(id => fetch(`${API_URL}/p/${projectSlug}/check`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ memberId: currentMember.id, pin, weekId: id, isChecked: false })
                }));
                const results = await Promise.all(promises);
                const lastData = await results[results.length - 1].json();

                if (lastData.success) {
                    checkedStates = lastData.checkedStates;
                } else {
                    showDialog("Erreur", lastData.error, false, null, () => { location.reload(); });
                }
            } catch (err) {
                showDialog("Erreur", "Problème réseau.", false, null, () => { location.reload(); });
            }
        });
        return;
    }

    // Checking Multiple Cases -> Wave Flow
    let totalAmount = 0;
    const validIds = [];
    ids.forEach(id => {
        const item = smartSchedule.scheduleList.find(w => w.id === id);
        if (item && !checkedStates[id] && !pendingStates[id]) {
            totalAmount += item.amount;
            validIds.push(id);
        }
    });

    if (validIds.length === 0) {
        return showDialog("Info", "Toutes ces cases sont déjà validées ou en attente.", false, null, () => { });
    }

    showDialog("Sécurité", `Pour Valider ${weeksLabel}, confirmez avec votre PIN :`, true, "", async (pin) => {
        if (!pin) return;

        showDialog("Accord de Paiement",
            `Le montant total à régler est de ${totalAmount.toLocaleString()} F. Payer avec Wave maintenant ?`,
            false, null,
            () => {
                const waveMerchantLink = `https://pay.wave.com/m/M_ci_kloDagYwzjtm/c/ci/?amount=${totalAmount}`;
                window.open(waveMerchantLink, '_blank');

                setTimeout(async () => {
                    showDialog("Confirmation de Paiement",
                        `Si vous n'avez pas payé avec votre compte, collez l'ID de transaction Wave ici (Optionnel) :`,
                        true, "", async (txId) => {
                            try {
                                const res = await fetch(`${API_URL}/p/${projectSlug}/pending`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ memberId: currentMember.id, weekIds: validIds, transactionId: txId || null })
                                });
                                const data = await res.json();
                                if (data.success) {
                                    pendingStates = data.pendingStates;
                                    renderMonths();
                                    renderHistory();
                                    updateDashboard();
                                    showDialog("Succès", "Cases en attente (oranges). Le trésorier la validera dès réception.", false, null, () => { });
                                } else {
                                    showDialog("Erreur", data.error || "PIN Incorrect ou erreur serveur.", false, null, () => { });
                                }
                            } catch (e) { console.error(e); }
                        });
                }, 1000);
            }
        );
    });
}


window.toggle = function (id) {
    const isCheckedCurrently = checkedStates[id];
    const isPendingCurrently = pendingStates[id];
    const item = smartSchedule.scheduleList.find(it => it.id === id);
    if (!item) return;

    if (isCheckedCurrently) {
        // Uncheck requires PIN (e.g., admin correction)
        const label = item.label;
        showDialog("Sécurité", `Pour Décocher [${label}], confirmez avec votre PIN :`, true, "", async (pin) => {
            const res = await fetch(`${API_URL}/p/${projectSlug}/check`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberId: currentMember.id, pin, weekId: id, isChecked: false })
            });
            const data = await res.json();
            if (data.success) {
                checkedStates = data.checkedStates;
                renderMonths();
                renderHistory();
                updateDashboard();
            } else {
                showDialog("Erreur", data.error, false, null, () => { });
            }
        });
        return;
    }

    if (isPendingCurrently) {
        showDialog("Information", "Cette case est déjà en attente de validation par le trésorier.", false, null, () => { });
        return;
    }

    // Checking the case directly -> PIN -> AMOUNT CONFIRM -> Initiate Wave Flow
    const amount = item.amount;

    showDialog("Sécurité", `Pour Valider [${item.label}], confirmez avec votre PIN :`, true, "", async (pin) => {
        if (!pin) return;

        showDialog("Accord de Paiement",
            `Vous êtes sur le point de régler ${amount.toLocaleString()} F via Wave. Voulez-vous continuer ?`,
            false, null,
            () => {
                const waveMerchantLink = `https://pay.wave.com/m/M_ci_kloDagYwzjtm/c/ci/?amount=${amount}`;
                window.open(waveMerchantLink, '_blank');

                setTimeout(async () => {
                    showDialog("Confirmation de Paiement",
                        `Si vous n'avez pas payé avec votre compte, collez l'ID de transaction Wave ici (Optionnel) :`,
                        true, "", async (txId) => {
                            try {
                                const res = await fetch(`${API_URL}/p/${projectSlug}/pending`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ memberId: currentMember.id, weekIds: [id], transactionId: txId || null })
                                });
                                const data = await res.json();
                                if (data.success) {
                                    pendingStates = data.pendingStates;
                                    renderMonths();
                                    renderHistory();
                                    updateDashboard();
                                    showDialog("Statut : En Attente", "Votre case est désormais en orange (En attente). Le trésorier la validera.", false, null, () => { });
                                } else {
                                    showDialog("Erreur", data.error || "PIN Incorrect ou erreur serveur.", false, null, () => { });
                                }
                            } catch (e) { console.error(e); }
                        });
                }, 1000);
            }
        );
    });
}

// Small Clean Dialog Logic
function showDialog(title, msg, isPrompt, defaultValue, callback, inputType = 'password') {
    const overlay = document.getElementById('dialog-overlay');
    document.getElementById('dialog-title').innerText = title;
    document.getElementById('dialog-msg').innerText = msg;
    const input = document.getElementById('dialog-input');

    if (isPrompt) {
        input.style.display = 'block';
        input.type = inputType; // Dynamic type
        input.value = defaultValue;

        // Adjust styling based on type
        if (inputType === 'password') {
            input.style.letterSpacing = '8px';
            input.style.textAlign = 'center';
            input.maxLength = 4;
        } else {
            input.style.letterSpacing = 'normal';
            input.style.textAlign = 'left';
            input.removeAttribute('maxlength');
        }

        setTimeout(() => input.focus(), 50);
    } else {
        input.style.display = 'none';
    }

    overlay.classList.add('show');

    const btnCancel = document.getElementById('dialog-btn-cancel');
    const btnOk = document.getElementById('dialog-btn-ok');

    const newBtnCancel = btnCancel.cloneNode(true); btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    const newBtnOk = btnOk.cloneNode(true); btnOk.parentNode.replaceChild(newBtnOk, btnOk);

    newBtnCancel.onclick = () => { overlay.classList.remove('show'); };
    newBtnOk.onclick = () => {
        overlay.classList.remove('show');
        callback(isPrompt ? input.value : true);
    };
}

function updateDashboard() {
    let mySaved = 0;
    let groupSaved = 0;
    let next = 0;
    let found = false;

    if (!smartSchedule || !smartSchedule.scheduleList) return;

    smartSchedule.scheduleList.forEach(item => {
        const i = item.id;
        const amt = item.amount;

        // Ma progression
        if (checkedStates[i]) mySaved += amt;

        // Progression groupe
        members.forEach(m => {
            const states = ((m.id === currentMember.id) ? checkedStates : m.checkedStates) || {};
            if (states[i]) groupSaved += amt;
        });

        if (!checkedStates[i] && !found) {
            next = amt;
            found = true;
        }
    });

    const totalMembers = members.length;
    const projectTarget = targetTotal();
    const collectiveTarget = projectTarget * totalMembers;

    const totalSavedEl = document.getElementById('total-saved');
    if (totalSavedEl) totalSavedEl.innerText = mySaved.toLocaleString();

    const nextDepositEl = document.getElementById('next-deposit');
    if (nextDepositEl) nextDepositEl.innerText = next.toLocaleString();

    const isGroup = members.length > 1;
    const statsBtn = document.querySelector('[data-tab="stats"]');
    if (statsBtn) statsBtn.style.display = isGroup ? 'flex' : 'none';

    if (isGroup) {
        const collectiveTarget = projectTarget * totalMembers;
        const collectiveRemaining = collectiveTarget - groupSaved;

        const remainingAmountEl = document.getElementById('remaining-amount');
        if (remainingAmountEl) remainingAmountEl.innerText = collectiveRemaining.toLocaleString();

        const footerLabelEl = document.getElementById('footer-label');
        if (footerLabelEl) footerLabelEl.innerText = "Cagnotte Collective";

        const p = collectiveTarget > 0 ? Math.round((groupSaved / collectiveTarget) * 100) : 0;
        const progressPercentEl = document.getElementById('progress-percent');
        if (progressPercentEl) progressPercentEl.innerText = `${p}%`;

        const progressBarFillEl = document.getElementById('progress-bar-fill');
        if (progressBarFillEl) progressBarFillEl.style.width = `${p}%`;

        renderGroupStats(groupSaved, collectiveTarget);

        // Check for Collective Victory
        if (p >= 100) {
            document.getElementById('app-title').innerHTML = `${currentProject.name} <span style="color:#ffd700">🏆</span>`;
        }
    } else {
        const soloRemaining = projectTarget - mySaved;
        const footerLabelEl = document.getElementById('footer-label');
        if (footerLabelEl) footerLabelEl.innerText = "Restant à épargner";
        const remainingAmountEl = document.getElementById('remaining-amount');
        if (remainingAmountEl) remainingAmountEl.innerText = soloRemaining.toLocaleString();

        const p = projectTarget > 0 ? Math.round((mySaved / projectTarget) * 100) : 0;
        const progressPercentEl = document.getElementById('progress-percent');
        if (progressPercentEl) progressPercentEl.innerText = `${p}%`;

        const progressBarFillEl = document.getElementById('progress-bar-fill');
        if (progressBarFillEl) progressBarFillEl.style.width = `${p}%`;
    }

    // Individual Victory Detection
    if (mySaved >= projectTarget && projectTarget > 0) {
        const hasCelebrated = localStorage.getItem(`celebrated_${projectSlug}_${currentMember.id}`);
        if (!hasCelebrated) {
            triggerVictory();
        }
    }
}

let syncInterval;
function startPolling() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(async () => {
        // Don't refresh if a dialog/modal is visible - it would feel glitchy
        const dialogOverlay = document.getElementById('dialog-overlay');
        const dialogOpen = dialogOverlay && dialogOverlay.classList.contains('visible');
        if (dialogOpen) return;

        try {
            const res = await fetch(`${API_URL}/p/${projectSlug}`);
            const data = await res.json();
            if (data && data.members) {
                // Compare both checkedStates AND pendingStates for full coverage
                const newHash = JSON.stringify(data.members.map(m => ({ c: m.checkedStates, p: m.pendingStates })));
                const oldHash = JSON.stringify(members.map(m => ({ c: m.checkedStates, p: m.pendingStates })));

                if (newHash !== oldHash) {
                    members = data.members;
                    smartSchedule = data.smartSchedule;
                    // Sync current user states from the server
                    const myData = members.find(m => m.id === currentMember.id);
                    if (myData) {
                        checkedStates = myData.checkedStates || {};
                        pendingStates = myData.pendingStates || {};
                    }

                    renderMonths();
                    renderHistory();
                    updateDashboard();
                }
            }
        } catch (e) { console.error("Sync error:", e); }
    }, 15000); // Poll every 15 seconds
}

/* --- VICTORY EFFECTS --- */

window.closeVictory = function () {
    const overlay = document.getElementById('victory-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.classList.remove('show');
            overlay.style.opacity = '1';
        }, 500);
    }
}

function triggerVictory() {
    // Record victory permanently for this device/user
    localStorage.setItem(`celebrated_${projectSlug}_${currentMember.id}`, 'true');
    const overlay = document.getElementById('victory-overlay');
    if (overlay) overlay.classList.add('show');
    startConfetti();
}

function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let particles = [];
    let animationFrame;
    const colors = ['#ffd700', '#ffffff', '#6366f1', '#818cf8', '#4f46e5'];

    for (let i = 0; i < 150; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 4 + 2,
            d: Math.random() * 10 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.random() * 10 - 10,
            tiltAngleIncremental: Math.random() * 0.07 + 0.05,
            tiltAngle: 0
        });
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let activeParticles = 0;

        particles.forEach((p, i) => {
            p.tiltAngle += p.tiltAngleIncremental;
            p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
            p.x += Math.sin(p.d);
            p.tilt = Math.sin(p.tiltAngle) * 15;

            ctx.beginPath();
            ctx.lineWidth = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
            ctx.stroke();

            if (p.y <= canvas.height) activeParticles++;
        });

        if (activeParticles > 0) {
            animationFrame = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            cancelAnimationFrame(animationFrame);
        }
    }

    draw();
}


function renderGroupStats(groupSaved, collectiveTarget) {
    const container = document.getElementById('tab-stats');
    if (!container) return;

    let memberStatsHtml = members.map(m => {
        const states = ((m.id === currentMember.id) ? checkedStates : m.checkedStates) || {};
        let total = 0;
        let count = 0;
        const totalPossible = (smartSchedule.scheduleList || []).length;

        (smartSchedule.scheduleList || []).forEach(item => {
            if (states[item.id]) {
                total += item.amount;
                count++;
            }
        });

        const isWinner = (totalPossible > 0 && count >= totalPossible);
        const color = getMemberColor(m);
        const nameSuffix = (m.id === currentMember.id) ? " (Vous)" : "";

        return `
            <div class="stat-card ${isWinner ? 'is-winner' : ''}">
                <div class="member-initial active" style="--member-color:${color}; width:32px; height:32px; font-size:12px;">
                    ${m.name.substring(0, 2).toUpperCase()}
                </div>
                <div style="flex:1; margin-left: 12px;">
                    <div style="font-weight:600; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                        ${m.name}${nameSuffix}
                        ${isWinner ? '🏆' : ''}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted)">
                        ${isWinner ? '<span class="badge-win">Challenge Terminé</span>' : `${count} semaines validées`}
                    </div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700; color:${isWinner ? '#ffd700' : 'var(--brand)'}">${total.toLocaleString()} F</div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="section-header">
            <h2>Statistiques du Groupe</h2>
        </div>
        <div class="stats-summary">
            <div class="summary-box">
                <span class="label">Cagnotte Collective</span>
                <span class="value">${groupSaved.toLocaleString()} F</span>
            </div>
            <div class="summary-box">
                <span class="label">Objectif Final</span>
                <span class="value">${collectiveTarget.toLocaleString()} F</span>
            </div>
        </div>
        <div style="display:grid; gap:12px; margin-top:20px;">
            ${memberStatsHtml}
        </div>
    `;
}







window.filterHistory = function (f) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        if (b.getAttribute('onclick').includes(`'${f}'`)) b.classList.add('active');
    });
    renderHistory();
}


/* --- THEME & PERSONALIZATION LOGIC --- */

window.toggleTheme = function () {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme_preference', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    if (isDark) {
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>';
    } else {
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>';
    }
}

// Initial Theme Check
const savedTheme = localStorage.getItem('theme_preference');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    updateThemeIcon(true);
}

window.openSettings = function () {
    if (!currentMember) return;
    document.getElementById('settings-overlay').classList.add('show');
    document.getElementById('settings-name').value = currentMember.name;

    // Render color palette
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#f97316', '#06b6d4'];
    const palette = document.getElementById('color-palette');
    palette.innerHTML = colors.map(c => `
        <div onclick="selectProfileColor('${c}')" style="width:30px; height:30px; border-radius:50%; background:${c}; cursor:pointer; border:2px solid ${currentMember.color === c ? 'white' : 'transparent'}; box-shadow:0 0 5px rgba(0,0,0,0.2)"></div>
    `).join('');
}

let selectedColor = null;
window.selectProfileColor = function (c) {
    selectedColor = c;
    openSettings(); // Re-render to show selection
}

window.closeSettings = function () {
    document.getElementById('settings-overlay').classList.remove('show');
}

window.saveProfile = async function () {
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) return;

    try {
        const res = await fetch(`${API_URL}/p/${projectSlug}/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                memberId: currentMember.id,
                name: newName,
                color: selectedColor || currentMember.color
            })
        });
        const data = await res.json();
        if (data.success) {
            currentMember.name = newName;
            currentMember.color = selectedColor || currentMember.color;
            updateDashboard();
            renderHistory();
            closeSettings();
            showDialog("Succès", "Profil mis à jour !", false);
        }
    } catch (err) {
        showDialog("Erreur", "Impossible de mettre à jour le profil.", false);
    }
}


/* --- CHECKOUT & WAVE PAYMENT --- */

function renderCheckout() {
    const list = document.getElementById('checkout-list');
    if (!list) return;

    if (!smartSchedule || !smartSchedule.scheduleList) return;

    // Filter weeks NOT checked yet AND NOT pending yet
    const pendingWeeks = smartSchedule.scheduleList.filter(w => !checkedStates[w.id] && !pendingStates[w.id]);

    if (pendingWeeks.length === 0) {
        list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:2rem; color:var(--text-muted)">Toutes vos semaines sont validées ! 🏆</div>`;
        updateCheckoutTotal();
        return;
    }

    list.innerHTML = pendingWeeks.map(w => {
        const isSelected = selectedCheckoutWeeks.has(w.id);
        return `
            <div class="checkout-item ${isSelected ? 'selected' : ''}" onclick="toggleCheckoutWeek(${w.id})">
                <div class="checkout-checkbox">
                    ${isSelected ? '<svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' : ''}
                </div>
                <div style="flex:1">
                    <div style="font-weight:600; font-size:0.9rem;">Semaine ${w.id}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted)">${new Date(w.date).toLocaleDateString()}</div>
                </div>
                <div style="font-weight:700; color:var(--brand)">${w.amount.toLocaleString()} F</div>
            </div>
        `;
    }).join('');

    updateCheckoutTotal();
}

window.toggleCheckoutWeek = function (id) {
    if (selectedCheckoutWeeks.has(id)) {
        selectedCheckoutWeeks.delete(id);
    } else {
        selectedCheckoutWeeks.add(id);
    }
    renderCheckout();
}

function updateCheckoutTotal() {
    let total = 0;
    selectedCheckoutWeeks.forEach(id => {
        const item = smartSchedule.scheduleList.find(w => w.id === id);
        if (item) total += item.amount;
    });

    document.getElementById('checkout-total').innerText = `${total.toLocaleString()} F`;
    const btn = document.getElementById('btn-pay-wave');
    if (btn) {
        btn.disabled = total === 0;
        btn.innerHTML = `Payer ${total.toLocaleString()} F via Wave`;
    }
}

window.initiateWavePayment = function () {
    let total = 0;
    let ids = [];
    selectedCheckoutWeeks.forEach(id => {
        const item = smartSchedule.scheduleList.find(w => w.id === id);
        if (item) {
            total += item.amount;
            ids.push(id);
        }
    });

    if (total === 0) {
        showDialog("Erreur", "Veuillez sélectionner au moins une semaine à payer.", false, null, () => { });
        return;
    }

    showDialog("Sécurité", `Pour confirmer votre versement de ${total.toLocaleString()} F, veuillez entrer votre PIN :`, true, "", (pin) => {
        if (!pin) return;

        showDialog("Transmission Wave", `Poursuivre vers Wave pour payer ${total.toLocaleString()} F ?`, false, null, () => {
            const waveMerchantLink = `https://pay.wave.com/m/M_ci_kloDagYwzjtm/c/ci/?amount=${total}`;
            window.open(waveMerchantLink, '_blank');

            setTimeout(async () => {
                showDialog("Confirmation de Paiement",
                    `Si vous n'avez pas payé avec votre compte, collez l'ID de transaction Wave ici (Optionnel) :`,
                    true, "", async (txId) => {

                        try {
                            const res = await fetch(`${API_URL}/p/${projectSlug}/pending`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ memberId: currentMember.id, weekIds: ids, transactionId: txId || null })
                            });
                            const data = await res.json();
                            if (data.success) {
                                pendingStates = data.pendingStates;
                                selectedCheckoutWeeks.clear();
                                renderCheckout();
                                renderMonths();
                                renderHistory();
                                updateDashboard();
                                showDialog("En Attente", "Vos cases sont en orange. Attente de la validation du trésorier.", false, null, () => { });

                            } else {
                                showDialog("Erreur", data.error || "Erreur ou PIN Incorrect.", false, null, () => { });
                            }
                        } catch (e) { console.error(e); }
                    });
            }, 1000);
        });
    });
}

init();
