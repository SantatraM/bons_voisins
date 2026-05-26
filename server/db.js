import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const dataDir = path.resolve('data');
const dataFile = path.join(dataDir, 'contacts-la-residence.json');
const backupFile = path.join(dataDir, 'contacts-la-residence.json.bak');
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

const sslRequired = process.env.PGSSLMODE === 'require' || /sslmode=require/i.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslRequired ? { rejectUnauthorized: false } : undefined
});

export const INTEREST_TAG_MAP = {
  'Plat du jour des Voisins': 'Plat du jour',
  'Menu des Voisins': 'Menu des voisins',
  Restaurant: 'Restaurant',
  'Take-away / commande à emporter': 'Take-away',
  Pizza: 'Pizza',
  Goûter: 'Goûter',
  Brunch: 'Brunch',
  'Piscine et loisirs': 'Piscine',
  'Moments conviviaux': 'Moments conviviaux',
  'Événements spéciaux': 'Événements spéciaux',
  'Anniversaires enfants': 'Anniversaire enfant',
  'Anniversaires adultes': 'Anniversaire adulte',
  'Chambres pour proches ou visiteurs': 'Chambres',
  'Salles de séminaire': 'Salles de séminaire',
  'Salles de réception': 'Salles de réception',
  'Offres entreprises': 'Offres entreprises',
  'Toutes les offres': 'Toutes les offres'
};

export const TAGS = [
  'Bons Voisins', 'Fidélité',
  'Plat du jour', 'Menu des voisins', 'Restaurant', 'Take-away', 'Pizza', 'Goûter',
  'Brunch', 'Piscine', 'Moments conviviaux', 'Événements spéciaux', 'Anniversaire enfant',
  'Anniversaire adulte', 'Chambres', 'Salles de séminaire', 'Salles de réception',
  'Offres entreprises', 'Toutes les offres',
  'Nouveau', 'À relancer', 'Prospect chaud', 'Contacté', 'Réservation confirmée', 'Sans suite', 'Client venu',
  'À vérifier', 'VIP', 'Doublon', 'Ne plus contacter'
];

const PROGRAM_TAGS = ['Bons Voisins', 'Fidélité'];
const COMMERCIAL_STATUS_TAGS = ['Nouveau', 'À relancer', 'Prospect chaud', 'Contacté', 'Réservation confirmée', 'Sans suite', 'Client venu'];
const MANAGEMENT_TAGS = ['À vérifier', 'VIP', 'Doublon', 'Ne plus contacter'];
const MOMENTS_SLOT_LABELS = {
  samedi_soir: 'Samedi soir',
  'Samedi soir': 'Samedi soir',
  dimanche_apres_midi: 'Dimanche après-midi',
  'Dimanche apres-midi': 'Dimanche après-midi',
  'Dimanche après-midi': 'Dimanche après-midi',
  les_deux: 'Les deux',
  'Les deux': 'Les deux'
};

const defaultState = () => ({
  ids: {
    users: 1,
    contacts: 1,
    tags: 1,
    consent_logs: 1,
    requests: 1,
    loyalty_accounts: 1,
    loyalty_transactions: 1,
    offers: 1
  },
  users: [],
  contacts: [],
  tags: [],
  contact_tags: [],
  consent_logs: [],
  requests: [],
  loyalty_accounts: [],
  loyalty_transactions: [],
  offers: []
});

let state = defaultState();
let readyPromise;

function storageError(error) {
  const wrapped = new Error('Nous n’avons pas pu enregistrer les données pour le moment. Merci de réessayer dans quelques secondes.');
  wrapped.code = 'STORAGE_WRITE_FAILED';
  wrapped.cause = error;
  return wrapped;
}

function categoryForTag(tag) {
  if (PROGRAM_TAGS.includes(tag)) return 'programme';
  if (COMMERCIAL_STATUS_TAGS.includes(tag)) return 'statut_commercial';
  if (MANAGEMENT_TAGS.includes(tag)) return 'gestion';
  return 'interet';
}

function normalizeJsonRow(row) {
  const data = row.data || {};
  return { ...data, id: Number(row.id) };
}

function normalizeContactIndexes(contact) {
  return {
    whatsapp: normalizeWhatsapp(contact.whatsapp || ''),
    emailLower: String(contact.email || '').trim().toLowerCase(),
    phoneNorm: normalizeWhatsapp(contact.telephone_principal || contact.phone || contact.telephone_secondaire || ''),
    createdAt: contact.created_at || '',
    statut: contact.statut || '',
    source: contact.source_formulaire || ''
  };
}

function loadJsonFallback() {
  const source = fs.existsSync(dataFile) ? dataFile : backupFile;
  if (!fs.existsSync(source)) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(source, 'utf8')) };
  } catch {
    return defaultState();
  }
}

async function query(client, text, params = []) {
  return client.query(text, params);
}

async function createSchema(client) {
  await query(client, `
    CREATE TABLE IF NOT EXISTS app_meta (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY,
      email text UNIQUE,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id integer PRIMARY KEY,
      whatsapp text,
      email_lower text,
      telephone_principal_norm text,
      created_at text,
      statut text,
      source_formulaire text,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id integer PRIMARY KEY,
      name text UNIQUE NOT NULL,
      category text NOT NULL,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_tags (
      contact_id integer NOT NULL,
      tag_id integer NOT NULL,
      created_at text NOT NULL,
      PRIMARY KEY (contact_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS consent_logs (
      id integer PRIMARY KEY,
      contact_id integer,
      created_at text,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id integer PRIMARY KEY,
      contact_id integer,
      source_formulaire text,
      campagne text,
      type_demande text,
      created_at text,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id integer PRIMARY KEY,
      contact_id integer UNIQUE,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id integer PRIMARY KEY,
      loyalty_account_id integer,
      contact_id integer,
      date text,
      created_at text,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      id integer PRIMARY KEY,
      nom_offre text,
      categorie text,
      statut text,
      data jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contacts_whatsapp_idx ON contacts (whatsapp);
    CREATE INDEX IF NOT EXISTS contacts_email_lower_idx ON contacts (email_lower);
    CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (telephone_principal_norm);
  `);
}

async function loadStateFromPostgres(client = pool) {
  const next = defaultState();
  const meta = await query(client, "SELECT value FROM app_meta WHERE key = 'ids'");
  if (meta.rows[0]?.value) next.ids = { ...next.ids, ...meta.rows[0].value };

  next.users = (await query(client, 'SELECT id, data FROM users ORDER BY id')).rows.map(normalizeJsonRow);
  next.contacts = (await query(client, 'SELECT id, data FROM contacts ORDER BY id')).rows.map(normalizeJsonRow);
  next.tags = (await query(client, 'SELECT id, data FROM tags ORDER BY id')).rows.map(normalizeJsonRow);
  next.contact_tags = (await query(client, 'SELECT contact_id, tag_id, created_at FROM contact_tags ORDER BY contact_id, tag_id')).rows.map((row) => ({
    contact_id: Number(row.contact_id),
    tag_id: Number(row.tag_id),
    created_at: row.created_at
  }));
  next.consent_logs = (await query(client, 'SELECT id, data FROM consent_logs ORDER BY id')).rows.map(normalizeJsonRow);
  next.requests = (await query(client, 'SELECT id, data FROM requests ORDER BY id')).rows.map(normalizeJsonRow);
  next.loyalty_accounts = (await query(client, 'SELECT id, data FROM loyalty_accounts ORDER BY id')).rows.map(normalizeJsonRow);
  next.loyalty_transactions = (await query(client, 'SELECT id, data FROM loyalty_transactions ORDER BY id')).rows.map(normalizeJsonRow);
  next.offers = (await query(client, 'SELECT id, data FROM offers ORDER BY id')).rows.map(normalizeJsonRow);
  state = next;
}

async function save() {
  const client = await pool.connect();
  try {
    await query(client, 'BEGIN');
    await query(client, "INSERT INTO app_meta (key, value) VALUES ('ids', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(state.ids)]);
    await query(client, 'TRUNCATE users, contacts, tags, contact_tags, consent_logs, requests, loyalty_accounts, loyalty_transactions, offers');

    for (const user of state.users) {
      await query(client, 'INSERT INTO users (id, email, data) VALUES ($1, $2, $3::jsonb)', [user.id, user.email || '', JSON.stringify(user)]);
    }
    for (const contact of state.contacts) {
      const index = normalizeContactIndexes(contact);
      await query(client, `INSERT INTO contacts (id, whatsapp, email_lower, telephone_principal_norm, created_at, statut, source_formulaire, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [contact.id, index.whatsapp, index.emailLower, index.phoneNorm, index.createdAt, index.statut, index.source, JSON.stringify(contact)]);
    }
    for (const tag of state.tags) {
      await query(client, 'INSERT INTO tags (id, name, category, data) VALUES ($1, $2, $3, $4::jsonb)', [tag.id, tag.name, tag.category, JSON.stringify(tag)]);
    }
    for (const item of state.contact_tags) {
      await query(client, 'INSERT INTO contact_tags (contact_id, tag_id, created_at) VALUES ($1, $2, $3)', [item.contact_id, item.tag_id, item.created_at || now()]);
    }
    for (const item of state.consent_logs) {
      await query(client, 'INSERT INTO consent_logs (id, contact_id, created_at, data) VALUES ($1, $2, $3, $4::jsonb)', [item.id, item.contact_id, item.created_at || '', JSON.stringify(item)]);
    }
    for (const item of state.requests) {
      await query(client, `INSERT INTO requests (id, contact_id, source_formulaire, campagne, type_demande, created_at, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [item.id, item.contact_id, item.source_formulaire || '', item.campagne || '', item.type_demande || '', item.created_at || '', JSON.stringify(item)]);
    }
    for (const item of state.loyalty_accounts) {
      await query(client, 'INSERT INTO loyalty_accounts (id, contact_id, data) VALUES ($1, $2, $3::jsonb)', [item.id, item.contact_id, JSON.stringify(item)]);
    }
    for (const item of state.loyalty_transactions) {
      await query(client, `INSERT INTO loyalty_transactions (id, loyalty_account_id, contact_id, date, created_at, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [item.id, item.loyalty_account_id, item.contact_id, item.date || '', item.created_at || '', JSON.stringify(item)]);
    }
    for (const item of state.offers) {
      await query(client, 'INSERT INTO offers (id, nom_offre, categorie, statut, data) VALUES ($1, $2, $3, $4, $5::jsonb)', [item.id, item.nom_offre || '', item.categorie || '', item.statut || '', JSON.stringify(item)]);
    }
    await query(client, 'COMMIT');
  } catch (error) {
    await query(client, 'ROLLBACK').catch(() => {});
    throw storageError(error);
  } finally {
    client.release();
  }
}

function nextId(table) {
  const id = state.ids[table] || 1;
  state.ids[table] = id + 1;
  return id;
}

async function ensureReady() {
  if (!readyPromise) readyPromise = migrate();
  return readyPromise;
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await createSchema(client);
    await loadStateFromPostgres(client);
    if (state.contacts.length === 0 && state.users.length === 0 && (fs.existsSync(dataFile) || fs.existsSync(backupFile))) {
      state = loadJsonFallback();
      await save();
    }
  } finally {
    client.release();
  }

  for (const name of TAGS) {
    const existing = state.tags.find((tag) => tag.name === name);
    if (existing) {
      existing.category = categoryForTag(name);
    } else {
      state.tags.push({ id: nextId('tags'), name, category: categoryForTag(name) });
    }
  }
  for (const contact of state.contacts) {
    contact.telephone_principal = contact.telephone_principal || contact.phone || contact.telephone_secondaire || '';
    contact.email = contact.email || '';
    contact.canal_reponse_prefere = contact.canal_reponse_prefere || '';
    contact.consentement_whatsapp = contact.consentement_whatsapp ?? contact.consentement_actif ?? 0;
    contact.consentement_email = contact.consentement_email ?? 0;
    contact.consentement_sms = contact.consentement_sms ?? 0;
    contact.statut_contact = contact.statut_contact || contact.statut || 'actif';
  }
  await save();
}

export async function seedDefaults() {
  await ensureReady();
  const email = process.env.ADMIN_EMAIL || 'admin@laresidence.mg';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  if (!state.users.some((user) => user.email === email)) {
    state.users.push({
      id: nextId('users'),
      name: 'Administrateur La Résidence',
      email,
      password_hash: bcrypt.hashSync(password, 10),
      role: 'administrateur',
      created_at: now()
    });
  }

  const offers = [
    ['Offre de bienvenue Bons Voisins', 'Bons Voisins', '1 café ou thé offert avec son biscuit maison lors de la prochaine visite.', 'active'],
    ['Plat du Jour des Voisins', 'Restaurant', 'Offre quartier autour du plat du jour.', 'brouillon'],
    ['Menu des Voisins', 'Restaurant', 'Offre quartier autour du menu des voisins.', 'brouillon']
  ];
  for (const [nom_offre, categorie, description, statut] of offers) {
    if (!state.offers.some((offer) => offer.nom_offre === nom_offre)) {
      state.offers.push({
        id: nextId('offers'),
        nom_offre,
        categorie,
        description,
        date_debut: '',
        date_fin: '',
        jours_horaires: '',
        public_cible: '',
        statut,
        notes: '',
        created_at: now(),
        updated_at: now()
      });
    }
  }
  await save();
}

export function normalizeWhatsapp(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim();
}

function publicContact(contact) {
  contact.telephone_principal = contact.telephone_principal || contact.phone || contact.telephone_secondaire || '';
  contact.email = contact.email || '';
  contact.canal_reponse_prefere = contact.canal_reponse_prefere || '';
  contact.consentement_whatsapp = contact.consentement_whatsapp ?? contact.consentement_actif ?? 0;
  contact.consentement_email = contact.consentement_email ?? 0;
  contact.consentement_sms = contact.consentement_sms ?? 0;
  contact.statut_contact = contact.statut_contact || contact.statut || 'actif';
  return {
    ...contact,
    tags: state.contact_tags
      .filter((item) => item.contact_id === contact.id)
      .map((item) => state.tags.find((tag) => tag.id === item.tag_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    loyalty: state.loyalty_accounts.find((account) => account.contact_id === contact.id) || null,
    requests: state.requests
      .filter((request) => request.contact_id === contact.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20),
    transactions: state.loyalty_transactions
      .filter((tx) => tx.contact_id === contact.id)
      .sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`))
      .slice(0, 30)
  };
}

export async function findUserByEmail(email) {
  await ensureReady();
  return state.users.find((user) => user.email === email) || null;
}

export async function listTags() {
  await ensureReady();
  return [...state.tags].sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`, 'fr'));
}

function hasTag(contact, name) {
  return contact.tags.some((tag) => tag.name === name);
}

function tagsByCategory(contact, category) {
  return contact.tags.filter((tag) => tag.category === category).map((tag) => tag.name);
}

function isValidWhatsapp(value) {
  return /^\+?\d{8,15}$/.test(normalizeWhatsapp(value));
}

function appendNote(contact, note) {
  const clean = String(note || '').trim();
  if (!clean) return;
  contact.notes_internes = [contact.notes_internes, clean].filter(Boolean).join('\n');
}

function consentFromRow(row) {
  const rawConsent = String(row.wantsWhatsapp ?? row.accord_whatsapp ?? '').trim().toLowerCase();
  return ['true', '1', 'oui', 'yes', 'y'].includes(rawConsent);
}

function normalizeSondageSlot(value) {
  const raw = String(value || '').trim();
  return MOMENTS_SLOT_LABELS[raw] || raw;
}

export async function addTags(contactId, tags = []) {
  await ensureReady();
  for (const name of new Set(tags.filter(Boolean))) {
    let tag = state.tags.find((item) => item.name === name);
    if (!tag) {
      tag = { id: nextId('tags'), name, category: categoryForTag(name) };
      state.tags.push(tag);
    }
    const exists = state.contact_tags.some((item) => item.contact_id === Number(contactId) && item.tag_id === tag.id);
    if (!exists) state.contact_tags.push({ contact_id: Number(contactId), tag_id: tag.id, created_at: now() });
  }
  await save();
}

export async function ensureLoyalty(contactId) {
  await ensureReady();
  const id = Number(contactId);
  let account = state.loyalty_accounts.find((item) => item.contact_id === id);
  if (!account) {
    account = {
      id: nextId('loyalty_accounts'),
      contact_id: id,
      passages_cycle: 0,
      cadeaux_disponibles: 0,
      cadeaux_remis: 0,
      dernier_passage: '',
      montant_cycle_actuel: 0,
      montant_cumule_total: 0,
      palier_super_bonus: 1500000,
      super_bonus_disponibles: 0,
      super_bonus_remis: 0,
      created_at: now(),
      updated_at: now()
    };
    state.loyalty_accounts.push(account);
    await save();
  }
  return account;
}

export async function upsertContact(input) {
  await ensureReady();
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  const email = String(input.email || '').trim();
  const phone = normalizeWhatsapp(input.telephone_principal || input.phone || '');
  if (!input.nom_prenom || (!whatsapp && !email && !phone)) throw new Error('Nom et au moins un moyen de contact requis.');

  const date = now();
  const consentWhatsapp = input.consentement_whatsapp ?? input.consentement_actif ?? false;
  const consentEmail = input.consentement_email ?? false;
  const consentSms = input.consentement_sms ?? false;
  const hasAnyMarketingConsent = Boolean(consentWhatsapp || consentEmail || consentSms);
  const sourceEntry = {
    source_formulaire: input.source_formulaire || 'admin',
    campagne: input.campagne || '',
    type_demande: input.type_demande || '',
    date_creation: date
  };
  const tags = [
    ...(input.tags || []),
    ...(input.centres_interet || []).map((item) => INTEREST_TAG_MAP[item] || item)
  ];
  let contact = whatsapp ? state.contacts.find((item) => normalizeWhatsapp(item.whatsapp) === whatsapp) : null;
  if (!contact && email) contact = state.contacts.find((item) => String(item.email || '').toLowerCase() === email.toLowerCase());
  if (!contact && phone) contact = state.contacts.find((item) => normalizeWhatsapp(item.telephone_principal || '') === phone);

  if (contact) {
    Object.assign(contact, {
      nom_prenom: input.nom_prenom || contact.nom_prenom,
      whatsapp: whatsapp || contact.whatsapp || '',
      email: email || contact.email || '',
      telephone_principal: phone || contact.telephone_principal || '',
      canal_reponse_prefere: input.canal_reponse_prefere || contact.canal_reponse_prefere || '',
      quartier_ou_lieu_travail: input.quartier_ou_lieu_travail || contact.quartier_ou_lieu_travail || '',
      type_contact: input.type_contact || contact.type_contact || '',
      tranche_age: input.tranche_age || contact.tranche_age || '',
      situation_professionnelle: input.situation_professionnelle || contact.situation_professionnelle || '',
      habitudes_sortie: input.habitudes_sortie || contact.habitudes_sortie || '',
      suggestion: input.suggestion || contact.suggestion || '',
      source_formulaire: input.source_formulaire || contact.source_formulaire || 'admin',
      campagne: input.campagne || contact.campagne || '',
      sources_json: [...(contact.sources_json || []), sourceEntry],
      updated_at: date
    });
    if (input.consentement_actif !== undefined) {
      contact.consentement_actif = hasAnyMarketingConsent ? 1 : 0;
      contact.consentement_whatsapp = consentWhatsapp ? 1 : 0;
      contact.consentement_email = consentEmail ? 1 : 0;
      contact.consentement_sms = consentSms ? 1 : 0;
      contact.date_consentement = hasAnyMarketingConsent ? date : contact.date_consentement;
      contact.texte_consentement_accepte = input.texte_consentement_accepte || contact.texte_consentement_accepte || '';
    }
    if (tags.includes('Bons Voisins')) contact.offre_bienvenue_disponible = 1;
  } else {
    contact = {
      id: nextId('contacts'),
      nom_prenom: input.nom_prenom,
      whatsapp,
      email,
      telephone_principal: phone,
      canal_reponse_prefere: input.canal_reponse_prefere || '',
      quartier_ou_lieu_travail: input.quartier_ou_lieu_travail || '',
      type_contact: input.type_contact || '',
      tranche_age: input.tranche_age || '',
      situation_professionnelle: input.situation_professionnelle || '',
      habitudes_sortie: input.habitudes_sortie || '',
      suggestion: input.suggestion || '',
      source_formulaire: input.source_formulaire || 'admin',
      campagne: input.campagne || '',
      sources_json: [sourceEntry],
      date_inscription: date,
      consentement_actif: hasAnyMarketingConsent ? 1 : 0,
      consentement_whatsapp: consentWhatsapp ? 1 : 0,
      consentement_email: consentEmail ? 1 : 0,
      consentement_sms: consentSms ? 1 : 0,
      date_consentement: hasAnyMarketingConsent ? date : '',
      texte_consentement_accepte: input.texte_consentement_accepte || '',
      statut: 'actif',
      statut_contact: 'actif',
      date_desinscription: '',
      mode_desinscription: '',
      notes_internes: '',
      offre_bienvenue_disponible: tags.includes('Bons Voisins') ? 1 : 0,
      offre_bienvenue_utilisee: 0,
      date_utilisation_offre: '',
      employe_validation: '',
      note_offre: '',
      created_at: date,
      updated_at: date
    };
    state.contacts.push(contact);
  }

  await save();
  await addTags(contact.id, tags);
  if (tags.includes('Fidélité')) await ensureLoyalty(contact.id);
  if (input.consentement_actif !== undefined) {
    state.consent_logs.push({
      id: nextId('consent_logs'),
      contact_id: contact.id,
      consentement_actif: hasAnyMarketingConsent ? 1 : 0,
      consentement_whatsapp: consentWhatsapp ? 1 : 0,
      consentement_email: consentEmail ? 1 : 0,
      consentement_sms: consentSms ? 1 : 0,
      texte: input.texte_consentement_accepte || '',
      source: input.source_formulaire || '',
      created_at: date
    });
    await save();
  }
  return getContact(contact.id);
}

export async function getContact(id) {
  await ensureReady();
  const contact = state.contacts.find((item) => item.id === Number(id));
  return contact ? publicContact(contact) : null;
}

export async function updateContact(id, data) {
  await ensureReady();
  const contact = state.contacts.find((item) => item.id === Number(id));
  if (!contact) return null;
  const fields = ['nom_prenom', 'email', 'telephone_principal', 'whatsapp', 'canal_reponse_prefere', 'consentement_whatsapp', 'consentement_email', 'consentement_sms', 'quartier_ou_lieu_travail', 'type_contact', 'tranche_age', 'situation_professionnelle', 'habitudes_sortie', 'suggestion', 'notes_internes', 'statut', 'statut_contact'];
  for (const field of fields) {
    if (data[field] !== undefined) contact[field] = data[field];
  }
  contact.updated_at = now();
  await save();
  if (Array.isArray(data.tags)) await addTags(contact.id, data.tags);
  return getContact(contact.id);
}

export async function addRequest(contactId, request) {
  await ensureReady();
  state.requests.push({
    id: nextId('requests'),
    contact_id: Number(contactId),
    source_formulaire: request.source_formulaire,
    campagne: request.campagne || '',
    type_demande: request.type_demande || '',
    payload_json: request.payload_json || {},
    created_at: now()
  });
  await save();
}

export async function dashboardStats() {
  await ensureReady();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const tagCount = (tagName) => {
    const tag = state.tags.find((item) => item.name === tagName);
    if (!tag) return 0;
    return new Set(state.contact_tags.filter((item) => item.tag_id === tag.id).map((item) => item.contact_id)).size;
  };
  return {
    total_contacts: state.contacts.length,
    nouveaux_semaine: state.contacts.filter((contact) => contact.created_at >= weekAgo).length,
    bons_voisins: tagCount('Bons Voisins'),
    fidelite: tagCount('Fidélité'),
    plat_du_jour: tagCount('Plat du jour'),
    pizza: tagCount('Pizza'),
    piscine: tagCount('Piscine'),
    chambres: tagCount('Chambres'),
    salles: tagCount('Salles de séminaire') + tagCount('Salles de réception'),
    desinscrits: state.contacts.filter((contact) => contact.statut === 'désinscrit').length,
    cadeaux_disponibles: state.loyalty_accounts.reduce((sum, account) => sum + account.cadeaux_disponibles, 0),
    super_bonus_disponibles: state.loyalty_accounts.reduce((sum, account) => sum + account.super_bonus_disponibles, 0),
    offres_actives: state.offers.filter((offer) => offer.statut === 'active').length
  };
}

// export async function listContacts(filters = {}) {
//   await ensureReady();
//   let rows = state.contacts.map(publicContact);
//   if (filters.q) {
//     const q = filters.q.toLowerCase();
//     rows = rows.filter((contact) => [contact.nom_prenom, contact.whatsapp, contact.quartier_ou_lieu_travail].some((value) => String(value || '').toLowerCase().includes(q)));
//   }
//   if (filters.source) rows = rows.filter((contact) => contact.source_formulaire === filters.source);
//   if (filters.quartier) rows = rows.filter((contact) => contact.quartier_ou_lieu_travail === filters.quartier);
//   if (filters.statut) rows = rows.filter((contact) => contact.statut === filters.statut);
//   if (filters.tranche_age) rows = rows.filter((contact) => contact.tranche_age === filters.tranche_age);
//   if (filters.situation) rows = rows.filter((contact) => contact.situation_professionnelle === filters.situation);
//   if (filters.habitudes) rows = rows.filter((contact) => contact.habitudes_sortie === filters.habitudes);
//   if (filters.consentement) rows = rows.filter((contact) => Boolean(contact.consentement_actif) === (filters.consentement === 'oui'));
//   if (filters.tag) rows = rows.filter((contact) => contact.tags.some((tag) => tag.name === filters.tag));
//   if (filters.interet) rows = rows.filter((contact) => contact.tags.some((tag) => tag.category === 'interet' && tag.name === filters.interet));
//   if (filters.programme) rows = rows.filter((contact) => contact.tags.some((tag) => tag.category === 'programme' && tag.name === filters.programme));
//   if (filters.statut_commercial) rows = rows.filter((contact) => contact.tags.some((tag) => tag.category === 'statut_commercial' && tag.name === filters.statut_commercial));
//   if (filters.preference_creneau) rows = rows.filter((contact) => contact.moments_conviviaux_slot === filters.preference_creneau);
//   if (filters.cadeau === 'oui') rows = rows.filter((contact) => (contact.loyalty?.cadeaux_disponibles || 0) > 0);
//   if (filters.super_bonus === 'oui') rows = rows.filter((contact) => (contact.loyalty?.super_bonus_disponibles || 0) > 0);
//   return rows
//     .sort((a, b) => b.created_at.localeCompare(a.created_at))
//     .slice(0, 300)
//     .map((contact) => ({
//       ...contact,
//       tags: contact.tags.map((tag) => tag.name),
//       tags_detail: contact.tags,
//       passages_cycle: contact.loyalty?.passages_cycle || 0,
//       montant_cumule_total: contact.loyalty?.montant_cumule_total || 0,
//       cadeaux_disponibles: contact.loyalty?.cadeaux_disponibles || 0,
//       super_bonus_disponibles: contact.loyalty?.super_bonus_disponibles || 0
//     }));
// }

export async function listContacts(filters = {}) {
  await ensureReady();

  const result = await pool.query(`
    SELECT * FROM contacts
    ORDER BY created_at DESC
  `);

  let rows = result.rows.map(publicContact);

  return rows.map((contact) => ({
    ...contact,
    tags: contact.tags.map((tag) => tag.name),
    tags_detail: contact.tags,
    passages_cycle: contact.loyalty?.passages_cycle || 0,
    montant_cumule_total: contact.loyalty?.montant_cumule_total || 0,
    cadeaux_disponibles: contact.loyalty?.cadeaux_disponibles || 0,
    super_bonus_disponibles: contact.loyalty?.super_bonus_disponibles || 0
  }));
}

export async function unsubscribeContact(id, mode) {
  await ensureReady();
  const contact = state.contacts.find((item) => item.id === Number(id));
  if (!contact) return null;
  contact.statut = 'désinscrit';
  contact.statut_contact = 'désinscrit';
  contact.consentement_actif = 0;
  contact.consentement_whatsapp = 0;
  contact.consentement_email = 0;
  contact.consentement_sms = 0;
  contact.date_desinscription = now();
  contact.mode_desinscription = mode || 'autre';
  contact.updated_at = now();
  await save();
  await addTags(contact.id, ['Ne plus contacter']);
  return getContact(contact.id);
}

export async function markWelcomeUsed(id, employe, note) {
  await ensureReady();
  const contact = state.contacts.find((item) => item.id === Number(id));
  if (!contact) return null;
  contact.offre_bienvenue_utilisee = 1;
  contact.offre_bienvenue_disponible = 0;
  contact.date_utilisation_offre = now();
  contact.employe_validation = employe || '';
  contact.note_offre = note || '';
  contact.updated_at = now();
  await save();
  return getContact(contact.id);
}

export function loyaltyView(account) {
  if (!account) return null;
  return {
    ...account,
    prochain_cadeau_dans: account.passages_cycle >= 10 ? 0 : 10 - account.passages_cycle,
    reste_avant_super_bonus: account.palier_super_bonus - account.montant_cycle_actuel
  };
}

export async function addLoyaltyPurchase(contactId, input, fallbackEmployee) {
  await ensureReady();
  const account = await ensureLoyalty(contactId);
  const amount = Number(input.montant);
  if (!input.invoice_number || !amount || !input.activite || !input.date) {
    throw new Error('Facture, montant, activité et date sont obligatoires.');
  }
  const isPrivate = input.achat_particulier === true || input.achat_particulier === 1 || input.achat_particulier === 'true';
  let passageAdded = 0;

  if (isPrivate) {
    account.montant_cumule_total += amount;
    account.montant_cycle_actuel += amount;
    while (account.montant_cycle_actuel >= account.palier_super_bonus) {
      account.super_bonus_disponibles += 1;
      account.montant_cycle_actuel -= account.palier_super_bonus;
    }

    const hasSameDayPassage = state.loyalty_transactions.some((tx) => tx.contact_id === Number(contactId) && tx.date === input.date && tx.passage_added && !tx.cancelled);
    if (amount >= 25000 && !hasSameDayPassage) {
      passageAdded = 1;
      account.passages_cycle += 1;
      account.dernier_passage = input.date;
      if (account.passages_cycle >= 10) {
        account.cadeaux_disponibles += 1;
        account.passages_cycle -= 10;
      }
    }
  }

  account.updated_at = now();
  state.loyalty_transactions.push({
    id: nextId('loyalty_transactions'),
    loyalty_account_id: account.id,
    contact_id: Number(contactId),
    date: input.date,
    type: passageAdded ? 'passage + achat' : 'achat',
    invoice_number: input.invoice_number,
    montant: amount,
    activite: input.activite,
    achat_particulier: isPrivate ? 1 : 0,
    employe: input.employe || fallbackEmployee,
    note: input.note || '',
    passage_added: passageAdded,
    cancelled: 0,
    created_at: now()
  });
  await save();
  return getContact(contactId);
}

export async function markReward(contactId, type, employee, note) {
  await ensureReady();
  const account = await ensureLoyalty(contactId);
  if (type === 'cadeau' && account.cadeaux_disponibles > 0) {
    account.cadeaux_disponibles -= 1;
    account.cadeaux_remis += 1;
  } else if (type === 'super_bonus' && account.super_bonus_disponibles > 0) {
    account.super_bonus_disponibles -= 1;
    account.super_bonus_remis += 1;
  } else {
    throw new Error('Aucune récompense disponible.');
  }
  account.updated_at = now();
  state.loyalty_transactions.push({
    id: nextId('loyalty_transactions'),
    loyalty_account_id: account.id,
    contact_id: Number(contactId),
    date: today(),
    type: type === 'cadeau' ? 'cadeau remis' : 'super bonus remis',
    invoice_number: '',
    montant: 0,
    activite: '',
    achat_particulier: 1,
    employe: employee,
    note: note || '',
    passage_added: 0,
    cancelled: 0,
    created_at: now()
  });
  await save();
  return getContact(contactId);
}

export async function marketingExport(filters = {}) {
  await ensureReady();
  const tagName = filters.tag || '';
  const interestName = filters.interet || '';
  const commercialStatus = filters.statut_commercial || '';
  const slot = filters.preference_creneau || '';
  const channel = filters.canal || 'whatsapp';
  return state.contacts
    .map(publicContact)
    .filter((contact) => contact.statut !== 'désinscrit' && contact.statut_contact !== 'désinscrit')
    .filter((contact) => {
      if (channel === 'email') return Boolean(contact.consentement_email && contact.email);
      if (channel === 'sms') return Boolean(contact.consentement_sms && contact.telephone_principal);
      return Boolean(contact.consentement_whatsapp && isValidWhatsapp(contact.whatsapp));
    })
    .filter((contact) => !hasTag(contact, 'Ne plus contacter'))
    .filter((contact) => !tagName || hasTag(contact, tagName))
    .filter((contact) => !interestName || contact.tags.some((tag) => tag.category === 'interet' && tag.name === interestName))
    .filter((contact) => !commercialStatus || contact.tags.some((tag) => tag.category === 'statut_commercial' && tag.name === commercialStatus))
    .filter((contact) => !slot || contact.moments_conviviaux_slot === slot)
    .sort((a, b) => a.nom_prenom.localeCompare(b.nom_prenom, 'fr'))
    .map((contact) => ({
      nom_prenom: contact.nom_prenom,
      whatsapp: contact.whatsapp,
      email: contact.email,
      telephone_principal: contact.telephone_principal,
      quartier_ou_lieu_travail: contact.quartier_ou_lieu_travail,
      source_formulaire: contact.source_formulaire,
      programmes: tagsByCategory(contact, 'programme').join(', '),
      centres_interet: tagsByCategory(contact, 'interet').join(', '),
      statut_commercial: tagsByCategory(contact, 'statut_commercial').join(', '),
      etiquettes_gestion: tagsByCategory(contact, 'gestion').join(', '),
      preference_creneau: contact.moments_conviviaux_slot || ''
    }));
}

export async function importSondageMomentsRows(rows = []) {
  await ensureReady();
  const report = {
    created: 0,
    updated: 0,
    ignored: 0,
    toVerify: 0,
    exportableWhatsapp: 0,
    errors: []
  };

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    try {
      const name = String(row.name || row.nom || row.nom_prenom || '').trim();
      const phone = String(row.phone || row.telephone || '').trim();
      const whatsapp = normalizeWhatsapp(row.whatsapp || '');
      const slot = normalizeSondageSlot(row.slot || row.choix || '');
      const note = String(row.note || '').trim();
      const createdAt = String(row.createdAt || row.date || '').trim();
      const hasConsent = Boolean(whatsapp) && consentFromRow(row);
      const hasPhoneOnly = !whatsapp && Boolean(phone);

      if (!name && !whatsapp && !phone) {
        report.ignored += 1;
        report.errors.push({ line, message: 'Ligne ignorée : aucun nom, téléphone ou WhatsApp.' });
        continue;
      }

      const date = now();
      let contact = whatsapp ? state.contacts.find((item) => normalizeWhatsapp(item.whatsapp) === whatsapp) : null;
      const tags = ['Moments conviviaux'];
      if (hasConsent) {
        tags.push('À relancer');
        if (slot) tags.push('Prospect chaud');
      } else {
        tags.push('À vérifier');
      }

      if (!contact) {
        contact = {
          id: nextId('contacts'),
          nom_prenom: name || phone || whatsapp || `Réponse sondage ${line}`,
          whatsapp: whatsapp || '',
          email: '',
          telephone_principal: phone,
          canal_reponse_prefere: whatsapp ? 'WhatsApp' : phone ? 'Appel téléphonique' : '',
          quartier_ou_lieu_travail: '',
          type_contact: '',
          tranche_age: '',
          situation_professionnelle: '',
          habitudes_sortie: '',
          suggestion: note,
          source_formulaire: 'Sondage Moments Conviviaux',
          campagne: 'moments-conviviaux',
          sources_json: [],
          date_inscription: createdAt || date,
          consentement_actif: hasConsent ? 1 : 0,
          consentement_whatsapp: hasConsent ? 1 : 0,
          consentement_email: 0,
          consentement_sms: 0,
          date_consentement: hasConsent ? (createdAt || date) : '',
          texte_consentement_accepte: hasConsent ? 'Accord WhatsApp collecté via le sondage Moments Conviviaux.' : '',
          statut: 'actif',
          statut_contact: 'actif',
          date_desinscription: '',
          mode_desinscription: '',
          notes_internes: '',
          telephone_secondaire: phone,
          moments_conviviaux_slot: slot,
          offre_bienvenue_disponible: 0,
          offre_bienvenue_utilisee: 0,
          date_utilisation_offre: '',
          employe_validation: '',
          note_offre: '',
          created_at: date,
          updated_at: date
        };
        state.contacts.push(contact);
        report.created += 1;
      } else {
        contact.nom_prenom = contact.nom_prenom || name;
        contact.telephone_secondaire = contact.telephone_secondaire || phone;
        contact.telephone_principal = contact.telephone_principal || phone;
        contact.suggestion = contact.suggestion || note;
        contact.source_formulaire = 'Sondage Moments Conviviaux';
        contact.campagne = 'moments-conviviaux';
        contact.moments_conviviaux_slot = slot || contact.moments_conviviaux_slot || '';
        contact.updated_at = date;
        report.updated += 1;
      }

      contact.sources_json = [
        ...(contact.sources_json || []),
        {
          source_formulaire: 'Sondage Moments Conviviaux',
          campagne: 'moments-conviviaux',
          type_demande: 'moments-conviviaux',
          date_creation: createdAt || date,
          preference_creneau: slot
        }
      ];

      const publicContactView = publicContact(contact);
      const blocked = contact.statut === 'désinscrit' || hasTag(publicContactView, 'Ne plus contacter');
      if (blocked) {
        appendNote(contact, `Réponse au sondage Moments Conviviaux le ${createdAt || date}. Contact non réactivé automatiquement car désinscrit ou marqué Ne plus contacter.`);
      } else {
        contact.consentement_actif = hasConsent ? 1 : 0;
        contact.consentement_whatsapp = hasConsent ? 1 : 0;
        contact.consentement_email = contact.consentement_email || 0;
        contact.consentement_sms = contact.consentement_sms || 0;
        if (hasConsent) {
          contact.date_consentement = contact.date_consentement || createdAt || date;
          contact.texte_consentement_accepte = contact.texte_consentement_accepte || 'Accord WhatsApp collecté via le sondage Moments Conviviaux.';
        }
      }

      const noteParts = [
        `Import sondage Moments Conviviaux${createdAt ? ` (${createdAt})` : ''}.`,
        slot ? `Préférence créneau : ${slot}.` : '',
        phone && !whatsapp ? `Téléphone sans WhatsApp confirmé : ${phone}.` : '',
        note ? `Note sondage : ${note}` : ''
      ].filter(Boolean);
      appendNote(contact, noteParts.join(' '));

      await addTags(contact.id, tags);
      if (hasPhoneOnly || !hasConsent) report.toVerify += 1;
    } catch (error) {
      report.ignored += 1;
      report.errors.push({ line, message: error.message });
    }
  }

  await save();
  report.exportableWhatsapp = (await marketingExport({ interet: 'Moments conviviaux' })).length;
  return report;
}

export async function listOffers() {
  await ensureReady();
  return [...state.offers].sort((a, b) => `${a.statut}-${a.date_debut}-${a.nom_offre}`.localeCompare(`${b.statut}-${b.date_debut}-${b.nom_offre}`, 'fr'));
}

export async function addOffer(data) {
  await ensureReady();
  state.offers.push({
    id: nextId('offers'),
    nom_offre: data.nom_offre,
    categorie: data.categorie || '',
    description: data.description || '',
    date_debut: data.date_debut || '',
    date_fin: data.date_fin || '',
    jours_horaires: data.jours_horaires || '',
    public_cible: data.public_cible || '',
    statut: data.statut || 'brouillon',
    notes: data.notes || '',
    created_at: now(),
    updated_at: now()
  });
  await save();
}
