import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import {
  addLoyaltyPurchase,
  addOffer,
  importSondageMomentsRows,
  addRequest,
  dashboardStats,
  findUserByEmail,
  getContact,
  listContacts,
  listOffers,
  listTags,
  loyaltyView,
  markReward,
  markWelcomeUsed,
  marketingExport,
  seedDefaults,
  unsubscribeContact,
  updateContact,
  upsertContact
} from './db.js';

dotenv.config();
await seedDefaults();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const CONSENT_TEXT = 'J’accepte de recevoir les informations et offres de La Résidence selon les canaux marketing que j’ai choisis. Je peux demander à ne plus recevoir ces messages à tout moment en envoyant STOP ou en le signalant à la réception.';
const ACTIVITY_TAGS = {
  brunch: 'Brunch',
  soiree: 'Événements spéciaux',
  'moments-conviviaux': 'Moments conviviaux',
  piscine: 'Piscine',
  anniversaire: 'Anniversaire adulte',
  chambre: 'Chambres',
  seminaire: 'Salles de séminaire',
  reception: 'Salles de réception',
  salle: 'Salles de réception',
  pizza: 'Pizza',
  'plat-du-jour': 'Plat du jour',
  'menu-des-voisins': 'Menu des voisins',
  'take-away': 'Take-away'
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Session expirée ou accès refusé.' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Accès non autorisé.' });
    next();
  };
}

function requestPayload(body) {
  const { nom_prenom, whatsapp, source_formulaire, campagne, type_demande, ...rest } = body;
  return rest;
}

function programConsent(body) {
  const marketing = Array.isArray(body.marketing_consent) ? body.marketing_consent : [];
  const hasWhatsapp = Boolean(String(body.whatsapp || '').trim());
  const hasSmsFallback = !hasWhatsapp && Boolean(String(body.telephone_principal || body.phone || '').trim());
  const consentEmail = Boolean(body.consentement_email || marketing.includes('email'));
  return {
    consentement_actif: hasWhatsapp || hasSmsFallback || consentEmail,
    consentement_whatsapp: hasWhatsapp,
    consentement_email: consentEmail,
    consentement_sms: hasSmsFallback
  };
}

function publicError(res, error) {
  const message = error.code === 'STORAGE_WRITE_FAILED'
    ? error.message
    : 'Nous n’avons pas pu enregistrer votre demande. Merci de vérifier les informations et de réessayer.';
  res.status(400).json({ message });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: 'postgres' }));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
  }
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: safeUser });
});

app.post('/api/public/bons-voisins', async (req, res) => {
  try {
    const contact = await upsertContact({
      ...req.body,
      source_formulaire: 'bons-voisins',
      ...programConsent(req.body),
      texte_consentement_accepte: CONSENT_TEXT,
      tags: ['Bons Voisins']
    });
    res.json({ contact_id: contact.id, message: 'Merci pour votre inscription aux Bons Voisins de La Résidence 🌿\nVotre offre de bienvenue vous attend :\n1 café ou thé offert avec son biscuit maison ☕🍪 lors de votre prochaine visite.' });
  } catch (error) {
    publicError(res, error);
  }
});

app.post('/api/public/fidelite', async (req, res) => {
  try {
    const contact = await upsertContact({
      ...req.body,
      source_formulaire: 'fidelite',
      ...programConsent(req.body),
      texte_consentement_accepte: CONSENT_TEXT,
      tags: ['Fidélité']
    });
    res.json({ contact_id: contact.id, message: 'Merci pour votre inscription au programme de fidélité de La Résidence 🌿\nVotre compte fidélité est maintenant créé.\nÀ chaque passage éligible, nous pourrons ajouter un tampon à votre carte fidélité.\nAprès 10 passages, un cadeau vous attend.\nVos achats cumulés pourront aussi vous permettre d’atteindre des super bonus.' });
  } catch (error) {
    publicError(res, error);
  }
});

app.post('/api/public/demande/:type', async (req, res) => {
  try {
    const submittedChoices = req.body.offres || [];
    const marketingChoices = req.body.marketing_consent || [];
    const choices = submittedChoices.includes('non') ? ['non'] : submittedChoices.filter((choice) => choice !== 'non');
    const marketing = marketingChoices.includes('non') ? ['non'] : marketingChoices.filter((choice) => choice !== 'non');
    const tags = [];
    tags.push('À relancer');
    if (choices.includes('bons_voisins')) tags.push('Bons Voisins');
    if (choices.includes('fidelite')) tags.push('Fidélité');
    if (choices.includes('activite') || marketing.some((item) => item !== 'non')) tags.push(ACTIVITY_TAGS[req.params.type] || req.body.type_demande_label || req.params.type);
    if (choices.includes('toutes')) tags.push('Toutes les offres');
    const hasDate = Boolean(req.body.date_souhaitee || req.body.date_arrivee || req.body.date_depart);
    const hasPeople = Boolean(Number(req.body.nombre_personnes || 0) || Number(req.body.total_personnes || 0) || Number(req.body.nombre_adultes || 0) || Number(req.body.nombre_enfants || 0));
    const hasPrecision = Boolean((req.body.message_precision || req.body.brunch_date_precision || '').trim());
    if ((hasDate && hasPeople) || hasPrecision) tags.push('Prospect chaud');
    const consentWhatsapp = marketing.includes('whatsapp');
    const consentEmail = marketing.includes('email');
    const consentSms = marketing.includes('sms') && !String(req.body.whatsapp || '').trim();
    const consent = consentWhatsapp || consentEmail || consentSms;
    const contact = await upsertContact({
      ...req.body,
      type_demande: req.params.type,
      source_formulaire: 'demande',
      consentement_actif: consent,
      consentement_whatsapp: consentWhatsapp,
      consentement_email: consentEmail,
      consentement_sms: consentSms,
      texte_consentement_accepte: consent ? CONSENT_TEXT : '',
      tags
    });
    await addRequest(contact.id, {
      source_formulaire: 'demande',
      campagne: req.body.campagne || '',
      type_demande: req.params.type,
      payload_json: requestPayload({ ...req.body, type_demande: req.params.type })
    });

    const summary = [
      'Merci pour votre demande 🌿',
      'Votre demande a bien été envoyée à l’équipe de La Résidence.',
      `Nous vous recontacterons selon votre canal préféré : ${req.body.canal_reponse_prefere || 'à confirmer'}.`,
      '',
      'Récapitulatif :',
      '✓ Demande reçue'
    ];
    if (tags.includes('Bons Voisins')) {
      summary.push('✓ Votre inscription aux Bons Voisins de La Résidence est également prise en compte.');
      summary.push('Votre offre de bienvenue vous attend : 1 café ou thé offert avec son biscuit maison ☕🍪 lors de votre prochaine visite.');
    }
    if (tags.includes('Fidélité')) {
      summary.push('✓ Votre compte fidélité est également créé.');
      summary.push('À chaque passage éligible, nous pourrons ajouter un tampon à votre carte fidélité.');
    }
    if (consentWhatsapp) summary.push('✓ Vous recevrez nos offres par WhatsApp.');
    if (consentEmail) summary.push('✓ Vous recevrez nos offres par e-mail.');
    if (consentSms) summary.push('✓ Vous recevrez nos offres par SMS.');
    if (choices.includes('toutes')) summary.push('✓ Vous recevrez toutes les offres de La Résidence.');
    if (!consent) summary.push('✓ Aucun consentement marketing n’a été ajouté. Cela n’empêche pas l’équipe de répondre à votre demande en cours.');

    res.json({ contact_id: contact.id, message: summary.join('\n') });
  } catch (error) {
    publicError(res, error);
  }
});

app.get('/api/admin/dashboard', auth, async (_req, res) => {
  res.json(await dashboardStats());
});

app.get('/api/admin/tags', auth, async (_req, res) => {
  res.json(await listTags());
});

app.get('/api/admin/contacts', auth, async (req, res) => {
  res.json(await listContacts(req.query));
});

app.post('/api/admin/contacts', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  try {
    res.json(await upsertContact({ ...req.body, source_formulaire: req.body.source_formulaire || 'admin' }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/admin/contacts/:id', auth, async (req, res) => {
  const contact = await getContact(req.params.id);
  if (!contact) return res.status(404).json({ message: 'Contact introuvable.' });
  contact.loyalty = loyaltyView(contact.loyalty);
  res.json(contact);
});

app.patch('/api/admin/contacts/:id', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  const contact = await updateContact(req.params.id, req.body);
  if (!contact) return res.status(404).json({ message: 'Contact introuvable.' });
  res.json(contact);
});

app.post('/api/admin/contacts/:id/unsubscribe', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  const contact = await unsubscribeContact(req.params.id, req.body.mode || 'autre');
  if (!contact) return res.status(404).json({ message: 'Contact introuvable.' });
  res.json(contact);
});

app.post('/api/admin/contacts/:id/welcome-used', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  const contact = await markWelcomeUsed(req.params.id, req.body.employe || req.user.name, req.body.note || '');
  if (!contact) return res.status(404).json({ message: 'Contact introuvable.' });
  res.json(contact);
});

app.post('/api/admin/contacts/:id/loyalty/purchase', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  try {
    res.json(await addLoyaltyPurchase(req.params.id, req.body, req.user.name));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post('/api/admin/contacts/:id/loyalty/reward', auth, requireRole(['administrateur', 'manager', 'reception']), async (req, res) => {
  try {
    res.json(await markReward(req.params.id, req.body.type, req.user.name, req.body.note || ''));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/admin/export/whatsapp', auth, requireRole(['administrateur', 'manager']), async (req, res) => {
  const channel = req.query.canal || 'whatsapp';
  const rows = await marketingExport({ ...req.query, canal: channel });
  const contactField = channel === 'email' ? 'email' : channel === 'sms' ? 'telephone_principal' : 'whatsapp';
  if (req.query.format === 'numbers') return res.type('text/plain').send(rows.map((row) => row[contactField]).filter(Boolean).join('\n'));
  const columns = ['nom_prenom', 'whatsapp', 'email', 'telephone_principal', 'quartier_ou_lieu_travail', 'source_formulaire', 'programmes', 'centres_interet', 'statut_commercial', 'etiquettes_gestion', 'preference_creneau'];
  const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(','))].join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.attachment(`export-${channel}-la-residence.csv`);
  res.send(csv);
});

app.post('/api/admin/imports/sondage-moments-conviviaux', auth, requireRole(['administrateur', 'manager']), async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    res.json(await importSondageMomentsRows(rows));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/admin/offers', auth, async (_req, res) => {
  res.json(await listOffers());
});

app.post('/api/admin/offers', auth, requireRole(['administrateur', 'manager']), async (req, res) => {
  await addOffer(req.body);
  res.json({ ok: true });
});

// app.use(express.static('dist'));
app.use(express.static(path.join(__dirname, '../dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Contacts La Résidence prêt sur http://localhost:${PORT}`);
});
