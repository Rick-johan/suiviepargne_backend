const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const path = require('path');
const bcrypt = require('bcryptjs');

// Serveur de fichiers statiques unifié (Le Studio est à la racine, le Client dans /suivi)
app.use(express.static(path.join(__dirname, '../frontend')));

// Redirection par défaut vers le Studio (qui est maintenant à la racine du frontend)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));


const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/epargne_pro_saas';
const MASTER_PIN = process.env.MASTER_PIN || '8888';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connecté à MongoDB (Plateforme SaaS)'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// --- SCHÉMAS MONGOOSE ---

// Nouveau : Modèle Administrateur pour ne plus dépendre du .env en dur
const AdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, default: 'admin' },
    password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', AdminSchema);

// Représente une "Cagnotte" (Un suivi d'épargne) générée via le Studio
const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // URL d'accès, ex: mon-beau-projet
    type: { type: String, enum: ['solo', 'groupe'], default: 'solo' },
    memberNames: [{ type: String }],
    createdAt: { type: Date, default: Date.now },

    // V2 Core Engine
    savingMode: { type: String, enum: ['progressive', 'fixed_constant', 'target_objective'], default: 'progressive' },
    baseAmount: { type: Number, default: 0 },
    targetAmount: { type: Number, default: 0 },
    startDate: { type: Date, default: () => new Date('2026-01-01') },
    endDate: { type: Date, default: () => new Date('2026-12-31') },
    billingCycle: { type: String, enum: ['weekly', 'monthly'], default: 'weekly' },
    billingDay: { type: Number, default: 4 }
});
const Project = mongoose.model('Project', ProjectSchema);

const MemberSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    color: { type: String }, // User personalization
    pin: { type: String, default: "0000" }, // PIN provisoire
    isFirstLogin: { type: Boolean, default: true }, // Oblige à changer le PIN 0000 la 1ère fois
    checkedStates: { type: Map, of: Boolean, default: {} },
    pendingStates: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} }
});
const Member = mongoose.model('Member', MemberSchema);

// Helper de sécurité : Compare un PIN (Clair ou Haché) et migre vers le hachage si nécessaire
async function compareMemberPin(member, inputPin) {
    if (!member || !inputPin) return false;

    // Le Master PIN est toujours autorisé (comparaison directe avec le .env)
    const master = String(process.env.MASTER_PIN || '8888');
    const provided = String(inputPin);

    if (provided === master) return true;

    const isHashed = member.pin && member.pin.startsWith('$2');
    if (isHashed) {
        return await bcrypt.compare(provided, member.pin);
    } else {
        // Migration transparente des anciens PINs en clair
        const match = (member.pin === provided);
        if (match) {
            // On profite de cette connexion réussie pour hacher le code en base
            member.pin = await bcrypt.hash(provided, 10);
            await member.save();
        }
        return match;
    }
}

// Représente l'historique des validations (Audit Trail)
const AuditLogSchema = new mongoose.Schema({
    action: { type: String, enum: ['approve', 'reject', 'undo'], required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    projectName: { type: String },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    memberName: { type: String },
    weekIds: [{ type: Number }],
    amount: { type: Number, default: 0 },
    transactionId: { type: String },
    date: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);


// --- MIDDLEWARE AUTH JWT ---
const authenticateAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: "Accès refusé. Token manquant." });

    try {
        const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Token invalide ou expiré." });
    }
};

// --- SMART SCHEDULER HELPER ---
function generateSmartSchedule(project, membersCount = 1) {
    const { startDate, endDate, savingMode, baseAmount, targetAmount, billingCycle, billingDay } = project;
    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const daysNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    let dates = [];

    let currentDt = new Date(startDate);
    currentDt.setHours(12, 0, 0, 0);
    let endDt = new Date(endDate);
    endDt.setHours(23, 59, 59, 999);

    if (savingMode === 'progressive' || savingMode === 'fixed_constant') {
        while (currentDt <= endDt) {
            dates.push(new Date(currentDt));
            currentDt.setDate(currentDt.getDate() + 7);
        }
    } else {
        if (billingCycle === 'weekly') {
            let targetDayJs = parseInt(billingDay) === 7 ? 0 : parseInt(billingDay);
            while (currentDt.getDay() !== targetDayJs) {
                currentDt.setDate(currentDt.getDate() + 1);
            }
            while (currentDt <= endDt) {
                dates.push(new Date(currentDt));
                currentDt.setDate(currentDt.getDate() + 7);
            }
        } else if (billingCycle === 'monthly') {
            if (currentDt.getDate() > parseInt(billingDay)) {
                currentDt.setMonth(currentDt.getMonth() + 1);
            }
            currentDt.setDate(parseInt(billingDay));
            while (currentDt <= endDt) {
                dates.push(new Date(currentDt));
                currentDt.setMonth(currentDt.getMonth() + 1);
            }
        }
    }

    if (dates.length === 0) return { calendar: [], scheduleList: [], unitTarget: 0, collectiveTarget: 0 };

    let N = dates.length;
    let schedule = [];
    let unitTarget = 0;

    if (savingMode === 'progressive' || savingMode === 'fixed_constant') {
        if (N > 1) {
            // Calcul du Total Progressif Théorique (Cible Finale Miroir)
            // Somme(i * base) de i=1 à originalN = base * N * (N+1) / 2
            let originalN = N;
            let progressiveTotalTarget = baseAmount * (originalN * (originalN + 1)) / 2;

            dates.pop(); // Enlever la dernière semaine (Avant-dernier)
            N = dates.length; // Active weeks

            if (savingMode === 'progressive') {
                // Mode Progressive Classique avec surcharge dispatchée
                let lastValue = originalN * baseAmount;
                let surchargePerWeek = lastValue / N;

                for (let i = 0; i < N; i++) {
                    let p = i + 1;
                    let amt = Math.round((p * baseAmount) + surchargePerWeek);
                    let lbl = `Semaine ${p}`;
                    schedule.push({ id: p, date: dates[i], amount: amt, label: lbl });
                    unitTarget += amt;
                }
            } else {
                // Mode Fixe Constante Miroir : On répartit le Total Progressif sur N semaines
                let amountPerWeek = Math.round(progressiveTotalTarget / N);
                for (let i = 0; i < N; i++) {
                    schedule.push({ id: i + 1, date: dates[i], amount: amountPerWeek, label: `Semaine ${i + 1}` });
                    unitTarget += amountPerWeek;
                }
            }
        } else {
            let amt = baseAmount;
            schedule.push({ id: 1, date: dates[0], amount: amt, label: 'Semaine 1' });
            unitTarget += amt;
        }
    } else if (savingMode === 'target_objective') {
        let mCount = membersCount > 0 ? membersCount : 1;
        let amtPerPerson = N > 0 ? Math.round(targetAmount / (mCount * N)) : 0;

        for (let i = 0; i < N; i++) {
            const lbl = billingCycle === 'monthly'
                ? `${monthNames[dates[i].getMonth()]} ${dates[i].getFullYear()}`
                : `Semaine ${i + 1}`;
            schedule.push({ id: i + 1, date: dates[i], amount: amtPerPerson, label: lbl });
            unitTarget += amtPerPerson;
        }
    }


    let grouped = [];
    let currentMap = new Map();

    schedule.forEach(item => {
        let yr = item.date.getFullYear();
        let mo = item.date.getMonth();
        let key = `${yr}-${mo}`;

        if (!currentMap.has(key)) {
            currentMap.set(key, { month: `${monthNames[mo]} ${yr}`, weeks: [] });
            grouped.push(currentMap.get(key));
        }

        let label = `${daysNames[item.date.getDay()]} ${item.date.getDate()}`;
        currentMap.get(key).weeks.push({
            id: item.id,
            label: label,
            amount: item.amount
        });
    });

    return {
        calendar: grouped,
        scheduleList: schedule,
        unitTarget: unitTarget,
        collectiveTarget: unitTarget * membersCount
    };
}

// ============================================
// ROUTES DU SUPER STUDIO (Espace Administrateur)
// ============================================

// Route spéciale d'initialisation (Setup)
// Elle ne fonctionne que si aucun admin n'existe
app.post('/api/admin/setup', async (req, res) => {
    const { username, password } = req.body;
    try {
        const count = await Admin.countDocuments();
        if (count > 0) {
            return res.status(403).json({ error: "L'administration est déjà configurée." });
        }

        if (!password || password.length < 4) {
            return res.status(400).json({ error: "Le mot de passe doit faire au moins 4 caractères." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await Admin.create({ username: username || 'admin', password: hashedPassword });

        res.json({ success: true, message: "Administrateur créé avec succès !" });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors du setup", details: err.message });
    }
});

// Login Admin
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    try {
        const admin = await Admin.findOne({ username: 'admin' });
        if (!admin) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const match = await bcrypt.compare(password, admin.password);
        if (!match) {
            return res.status(403).json({ error: "Mot de passe incorrect" });
        }

        const token = jwt.sign({ role: 'admin', id: admin._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: "Erreur de connexion" });
    }
});

// Créer un nouveau projet d'épargne
app.post('/api/admin/projects', authenticateAdmin, async (req, res) => {
    const { name, slug, type, memberNames, savingMode, baseAmount, targetAmount, startDate, endDate, billingCycle, billingDay } = req.body;

    try {
        const existing = await Project.findOne({ slug });
        if (existing) return res.status(400).json({ error: "Ce lien (slug) est déjà utilisé par un autre projet." });

        const project = new Project({
            name, slug, type, memberNames,
            savingMode: savingMode || 'progressive',
            baseAmount: baseAmount || 0,
            targetAmount: targetAmount || 0,
            startDate: startDate ? new Date(startDate) : new Date('2026-01-01'),
            endDate: endDate ? new Date(endDate) : new Date('2026-12-31'),
            billingCycle: billingCycle || 'weekly',
            billingDay: billingDay || 4
        });
        await project.save();

        // Enregistre tous les membres invités avec un PIN '0000'
        const membersList = memberNames.map(mName => ({
            projectId: project._id,
            name: mName
        }));
        await Member.insertMany(membersList);

        res.json({ success: true, project, url: `/${slug}` });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la création du projet", details: err.message });
    }
});

// Récupérer la liste des projets existants (Avec stats pour le Studio)
app.get('/api/admin/projects', authenticateAdmin, async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });

        // Calculer les stats de base pour chaque projet
        const projectsWithStats = await Promise.all(projects.map(async p => {
            const members = await Member.find({ projectId: p._id });
            const memberCount = members.length;
            const schedule = generateSmartSchedule(p, memberCount);

            const unitTarget = schedule.unitTarget;
            const collectiveTarget = schedule.collectiveTarget;

            let collectiveSaved = 0;
            members.forEach(m => {
                schedule.scheduleList.forEach(item => {
                    if (m.checkedStates.get(item.id.toString())) {
                        collectiveSaved += item.amount;
                    }
                });
            });

            // Détail par membre pour le Studio
            const memberDetails = members.map(m => {
                let mTotal = 0;
                let mCount = 0;
                schedule.scheduleList.forEach(item => {
                    if (m.checkedStates.get(item.id.toString())) {
                        mTotal += item.amount;
                        mCount++;
                    }
                });
                return {
                    name: m.name,
                    total: mTotal,
                    count: mCount,
                    target: unitTarget // L'objectif personnel de chacun
                };
            });

            return {
                ...p.toObject(),
                id: p._id,
                memberDetails,
                stats: {
                    percent: collectiveTarget > 0 ? Math.round((collectiveSaved / collectiveTarget) * 100) : 0,
                    totalSaved: collectiveSaved,
                    totalTarget: collectiveTarget,
                    memberCount,
                    totalProgressCount: schedule.scheduleList.length
                }
            };
        }));

        res.json(projectsWithStats);
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la récupération des projets" });
    }
});

// Mettre à jour un projet existant
app.put('/api/admin/projects/:id', authenticateAdmin, async (req, res) => {
    const projectId = req.params.id;
    const { name, slug, type, memberNames, savingMode, baseAmount, targetAmount, startDate, endDate, billingCycle, billingDay } = req.body;

    try {
        const project = await Project.findById(projectId);
        if (!project) return res.status(404).json({ error: "Projet introuvable." });

        // Vérifier si le nouveau slug est déjà pris par un autre projet
        if (slug !== project.slug) {
            const existing = await Project.findOne({ slug });
            if (existing) return res.status(400).json({ error: "Ce lien (slug) est déjà utilisé." });
        }

        // Mise à jour des champs
        project.name = name || project.name;
        project.slug = slug || project.slug;
        project.type = type || project.type;
        project.memberNames = memberNames || project.memberNames;
        project.savingMode = savingMode || project.savingMode;
        project.baseAmount = (baseAmount !== undefined) ? baseAmount : project.baseAmount;
        project.targetAmount = (targetAmount !== undefined) ? targetAmount : project.targetAmount;
        project.startDate = startDate ? new Date(startDate) : project.startDate;
        project.endDate = endDate ? new Date(endDate) : project.endDate;
        project.billingCycle = billingCycle || project.billingCycle;
        project.billingDay = (billingDay !== undefined) ? billingDay : project.billingDay;

        await project.save();

        // Gestion des membres (Sync)
        // Simplification : On s'assure que chaque nom dans memberNames a un document Member
        const existingMembers = await Member.find({ projectId });
        const existingNames = existingMembers.map(m => m.name);

        // Ajouter les nouveaux
        const toAdd = memberNames.filter(n => !existingNames.includes(n));
        if (toAdd.length > 0) {
            await Member.insertMany(toAdd.map(name => ({ projectId, name })));
        }

        // Note: On ne supprime pas automatiquement les membres retirés de la liste pour éviter la perte de données (paiements)
        // Mais on pourrait le faire si l'utilisateur le demande explicitement.

        res.json({ success: true, project });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la mise à jour", details: err.message });
    }
});

// Supprimer un projet et ses membres
app.delete('/api/admin/projects/:id', authenticateAdmin, async (req, res) => {
    try {
        const projectId = req.params.id;
        await Project.findByIdAndDelete(projectId);
        await Member.deleteMany({ projectId: projectId });
        await AuditLog.deleteMany({ projectId: projectId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la suppression" });
    }
});

// Mettre à jour le mot de passe Admin (Global)
app.post('/api/admin/change-pass', authenticateAdmin, async (req, res) => {
    const { newPassword } = req.body;
    try {
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: "Le mot de passe doit faire au moins 4 caractères." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await Admin.updateOne({ username: 'admin' }, { password: hashedPassword });

        res.json({ success: true, message: "Mot de passe Admin mis à jour de façon permanente." });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la mise à jour." });
    }
});

// Récupérer TOUS les paiements en attente (Global Admin)
app.get('/api/admin/pending-payments', authenticateAdmin, async (req, res) => {
    try {
        const members = await Member.find().populate('projectId');
        const results = [];
        members.forEach(m => {
            const pendingMap = m.pendingStates;
            if (pendingMap && pendingMap.size > 0) {
                const weekIds = Array.from(pendingMap.keys());
                let txId = null;
                let txDate = null;

                weekIds.forEach(w => {
                    const obj = pendingMap.get(w);
                    if (obj && obj.transactionId) { txId = obj.transactionId; }
                    if (obj && obj.date) { txDate = obj.date; }
                });

                results.push({
                    memberId: m._id,
                    memberName: m.name,
                    projectName: m.projectId ? m.projectId.name : 'Projet Supprimé',
                    projectSlug: m.projectId ? m.projectId.slug : '',
                    weekIds: weekIds,
                    transactionId: txId,
                    date: txDate
                });
            }
        });
        res.json({ success: true, pendingPayments: results });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la récupération des attentes" });
    }
});


// ============================================
// ROUTES DU CLIENT (Pour l'interface Frontend)
// ============================================

// 1. Récupérer les données pour afficher une page client depuis son lien
app.get('/api/p/:slug', async (req, res) => {
    try {
        const project = await Project.findOne({ slug: req.params.slug });
        if (!project) return res.status(404).json({ error: "Projet introuvable à cette adresse." });

        // On récupère les membres liés
        const members = await Member.find({ projectId: project._id });

        // On NE RENVOIE PAS le champ `pin` au frontend pour raison de sécurité !
        const memberData = members.map(m => ({
            id: m._id,
            name: m.name,
            color: m.color,
            isFirstLogin: m.isFirstLogin,
            checkedStates: Object.fromEntries(m.checkedStates),
            pendingStates: Object.fromEntries(m.pendingStates || new Map())
        }));

        const smartSchedule = generateSmartSchedule(project, members.length);

        res.json({ project, members: memberData, smartSchedule });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Connexion d'un membre (Choix du profil + PIN)
app.post('/api/auth/login', async (req, res) => {
    const { memberId, pin } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre non reconnu" });

        const isMatch = await compareMemberPin(member, pin);
        if (!isMatch) {
            return res.status(403).json({ error: "Code PIN incorrect" });
        }

        // Si c'est le MASTER_PIN qui est utilisé, on force un reset du PIN pour ce membre
        if (String(pin) === String(MASTER_PIN) && member.pin !== String(MASTER_PIN)) {
            member.isFirstLogin = true;
            await member.save();
        }

        res.json({ success: true, isFirstLogin: !!member.isFirstLogin });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Modifier le PIN Secret (Obligatoire au premier Login pour se séparer de 0000)
app.post('/api/auth/update-pin', async (req, res) => {
    const { memberId, currentPin, newPin } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre introuvable" });

        const isMatch = await compareMemberPin(member, currentPin);
        if (!isMatch) {
            return res.status(403).json({ error: "L'ancien code n'est pas correct" });
        }

        // Hachage du nouveau PIN
        member.pin = await bcrypt.hash(String(newPin), 10);
        member.isFirstLogin = false; // Il a sécurisé son compte
        await member.save();

        res.json({ success: true, message: "Code PIN enregistré." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Cocher ou Décocher une Semaine (Le clic)
app.post('/api/p/:slug/check', async (req, res) => {
    // Pour une action, le frontend doit obligatoirement renvoyer le PIN de la session en cours
    const { memberId, pin, weekId, isChecked } = req.body;

    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Erreur de membre" });

        const isMatch = await compareMemberPin(member, pin);
        if (!isMatch) {
            return res.status(403).json({ error: "Transaction refusée: Code PIN invalide" });
        }

        member.checkedStates.set(weekId.toString(), isChecked);
        await member.save();

        res.json({ success: true, checkedStates: Object.fromEntries(member.checkedStates) });
    } catch (err) {
        res.status(500).json({ error: "Erreur interne" });
    }
});

// 5. Marquer une Semaine comme "En Attente" (Après clic sur Payer Wave)
app.post('/api/p/:slug/pending', async (req, res) => {
    const { memberId, weekIds, transactionId } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre non reconnu" });

        (weekIds || []).forEach(id => {
            member.pendingStates.set(id.toString(), {
                date: Date.now(),
                transactionId: transactionId || null
            });
        });

        await member.save();
        res.json({ success: true, pendingStates: Object.fromEntries(member.pendingStates) });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la mise en attente" });
    }
});

// 9. Admin: Annuler une validation ou un rejet
app.post('/api/admin/audit-logs/undo', authenticateAdmin, async (req, res) => {
    const { logId } = req.body;
    try {
        const log = await AuditLog.findById(logId);
        if (!log) return res.status(404).json({ error: "Log introuvable" });

        const member = await Member.findById(log.memberId);
        if (!member) return res.status(404).json({ error: "Membre introuvable" });

        if (log.action === 'approve') { // Undo approval
            (log.weekIds || []).forEach(id => {
                member.checkedStates.set(id.toString(), false);
            });
        } else if (log.action === 'reject') { // Undo rejection
            (log.weekIds || []).forEach(id => {
                member.pendingStates.set(id.toString(), { date: Date.now(), transactionId: log.transactionId });
            });
        }
        await member.save();

        // Create an explicit trace of the undo action
        await AuditLog.create({
            action: 'undo',
            projectId: log.projectId,
            projectName: log.projectName,
            memberId: log.memberId,
            memberName: log.memberName,
            weekIds: log.weekIds,
            transactionId: log.transactionId
        });

        // Delete the original log
        await AuditLog.findByIdAndDelete(logId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erreur d'annulation" });
    }
});

// Admin: Supprimer un audit log entierement
app.delete('/api/admin/audit-logs/:id', authenticateAdmin, async (req, res) => {
    try {
        await AuditLog.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la suppression" });
    }
});

// 6. Admin: Valider un paiement (Passer de Pending à Checked)
app.post('/api/admin/approve-payment', authenticateAdmin, async (req, res) => {
    const { memberId, weekIds } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre introuvable" });

        let txId = null;
        (weekIds || []).forEach(id => {
            const pendingData = member.pendingStates.get(id.toString());
            if (pendingData && pendingData.transactionId) txId = pendingData.transactionId;
            member.pendingStates.delete(id.toString());
            member.checkedStates.set(id.toString(), true);
        });

        await member.save();

        const project = member.projectId ? await Project.findById(member.projectId) : null;

        await AuditLog.create({
            action: 'approve',
            projectId: member.projectId,
            projectName: project ? project.name : 'Projet',
            memberId: member._id,
            memberName: member.name,
            weekIds: weekIds || [],
            transactionId: txId
        });

        res.json({ success: true });
    } catch (err) {
        console.error("APP_ERROR:", err);
        res.status(500).json({ error: "Erreur lors de l'approbation", details: err.message });
    }
});

// 7. Admin: Rejeter un paiement
app.post('/api/admin/reject-payment', authenticateAdmin, async (req, res) => {
    const { memberId, weekIds } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre introuvable" });

        let txId = null;
        (weekIds || []).forEach(id => {
            const pendingData = member.pendingStates.get(id.toString());
            if (pendingData && pendingData.transactionId) txId = pendingData.transactionId;
            member.pendingStates.delete(id.toString());
        });

        await member.save();

        const project = await Project.findById(member.projectId);

        await AuditLog.create({
            action: 'reject',
            projectId: member.projectId,
            projectName: project ? project.name : 'Projet',
            memberId: member._id,
            memberName: member.name,
            weekIds: weekIds || [],
            transactionId: txId
        });

        res.json({ success: true });
    } catch (err) {
        console.error("REJ_ERROR:", err);
        res.status(500).json({ error: "Erreur lors du rejet", details: err.message });
    }
});

// 8. Admin: Récupérer l'historique d'audit
app.get('/api/admin/audit-logs', authenticateAdmin, async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ date: -1 }).limit(50);
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ error: "Erreur audit" });
    }
});

// 5. Mettre à jour le profil (Nom et Couleur)
app.post('/api/auth/update-profile', async (req, res) => {
    const { memberId, name, color } = req.body;
    try {
        const member = await Member.findById(memberId);
        if (!member) return res.status(404).json({ error: "Membre introuvable" });

        member.name = name;
        member.color = color;
        await member.save();

        res.json({ success: true, message: "Profil mis à jour." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Hub SaaS "Épargne Pro" actif - Connectez le Studio sur le port ${PORT}`);
});
