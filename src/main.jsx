import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  ClipboardList,
  Download,
  Gift,
  LogOut,
  MessageCircle,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Utensils
} from 'lucide-react';
import { brunchDates } from './config/eventDates';
import { buildWhatsAppLink, residenceWhatsappNumber, whatsappMessages } from './config/whatsapp';
import './styles.css';

const interests = [
  'Plat du jour des Voisins', 'Menu des Voisins', 'Restaurant', 'Take-away / commande à emporter',
  'Pizza', 'Goûter', 'Brunch', 'Piscine et loisirs', 'Moments conviviaux', 'Événements spéciaux',
  'Anniversaires enfants', 'Anniversaires adultes', 'Chambres pour proches ou visiteurs',
  'Salles de séminaire', 'Salles de réception', 'Offres entreprises', 'Toutes les offres'
];

const ageOptions = ['Moins de 25 ans', '25–34 ans', '35–44 ans', '45–54 ans', '55 ans et plus', 'Je préfère ne pas répondre'];
const jobOptions = ['Salarié(e)', 'Entrepreneur ou indépendant(e)', 'Commerçant(e)', 'Cadre, responsable ou dirigeant(e)', 'Fonction publique ou administration', 'Étudiant(e)', 'Sans activité professionnelle actuellement', 'Retraité(e)', 'Je préfère ne pas répondre', 'Autre'];
const outingOptions = ['Plusieurs fois par semaine', 'Environ une fois par semaine', 'Environ deux fois par mois', 'Environ une fois par mois', 'Moins souvent', 'Cela dépend des offres proposées'];
const consentText = 'J’accepte de recevoir les informations et offres de La Résidence par WhatsApp et/ou e-mail selon mes centres d’intérêt. Je peux demander à ne plus recevoir ces messages à tout moment en envoyant STOP par WhatsApp ou en le signalant à la réception.';
const channelConsentText = 'J’accepte de recevoir les informations et offres de La Résidence selon les canaux sélectionnés. Je peux demander à ne plus recevoir ces messages à tout moment.';
const API = '/api';
const otherBrunchDate = 'Autre date / demande spéciale';
const peopleSplitTypes = ['brunch', 'soiree', 'moments-conviviaux', 'piscine', 'anniversaire'];
const momentsSlotOptions = ['Samedi soir', 'Dimanche après-midi', 'Les deux'];

function localToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function formatFrenchDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month - 1, day)).replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

function nextSundays(count = 4) {
  const dates = [];
  const cursor = localToday();
  const daysUntilSunday = (7 - cursor.getDay()) % 7;
  cursor.setDate(cursor.getDate() + daysUntilSunday);
  while (dates.length < count) {
    dates.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
}

function getBrunchOptions() {
  const todayIso = isoDate(localToday());
  const configured = brunchDates
    .filter((date) => date >= todayIso)
    .sort()
    .slice(0, 4);
  const dates = configured.length ? [...configured] : nextSundays(4);
  if (configured.length && dates.length < 4) {
    for (const sunday of nextSundays(8)) {
      if (dates.length >= 4) break;
      if (!dates.includes(sunday)) dates.push(sunday);
    }
    dates.sort();
  }
  return [
    ...dates.map((date) => ({ value: date, label: formatFrenchDate(date) })),
    { value: otherBrunchDate, label: otherBrunchDate }
  ];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function api(path, options = {}) {
  const token = localStorage.getItem('lr_token');
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (res) => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Une erreur est survenue.');
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
  });
}

function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to) => {
    history.pushState(null, '', to);
    setPath(to);
    scrollTo(0, 0);
  };
  return { path, navigate };
}

function Button({ children, variant = 'primary', ...props }) {
  return <button className={`btn ${variant}`} {...props}>{children}</button>;
}

function TextInput({ label, required, ...props }) {
  return <label className="field"><span>{label}{required && ' *'}</span><input required={required} {...props} /></label>;
}

function SelectInput({ label, options, required, ...props }) {
  return <label className="field"><span>{label}{required && ' *'}</span><select required={required} {...props}><option value="">Choisir</option>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function CheckboxGroup({ label, values, selected, onChange }) {
  const toggle = (value) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  return <div className="field wide"><span>{label}</span><div className="checks">{values.map((value) => <label key={value} className="check"><input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />{value}</label>)}</div></div>;
}

function ChoiceGroup({ label, choices, selected, onChange, exclusiveValue }) {
  const [open, setOpen] = useState('');
  const toggle = (value) => {
    if (value === exclusiveValue) return onChange(selected.includes(value) ? [] : [value]);
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected.filter((item) => item !== exclusiveValue), value];
    onChange(next);
  };
  return <div className="field wide"><span>{label}</span><div className="choice-list">{choices.map((choice) => <div className="choice-item" key={choice.value}><label className="check"><input type="checkbox" checked={selected.includes(choice.value)} onChange={() => toggle(choice.value)} />{choice.label}</label>{choice.details && <button className="learn-link" type="button" onClick={() => setOpen(open === choice.value ? '' : choice.value)}>En savoir plus</button>}{open === choice.value && <div className="choice-help">{choice.details}</div>}</div>)}</div></div>;
}

function PublicShell({ children }) {
  return <main className="public-shell">
    <section className="brand-panel">
      <div className="brand-mark"><Utensils size={28} /></div>
      <p>Hôtel • Restaurant • Antananarivo</p>
      <h1>Contacts La Résidence</h1>
      <span>Une inscription simple, claire et sans application à installer.</span>
    </section>
    {children}
  </main>;
}

function OptionalProfile({ form, setForm }) {
  return <section className="form-section">
    <h3>Pour mieux vous envoyer les bonnes offres</h3>
    <p>Ces questions sont facultatives. Elles nous aident simplement à vous proposer les offres les plus adaptées à vos habitudes.</p>
    <div className="grid two">
      <SelectInput label="Tranche d’âge" options={ageOptions} value={form.tranche_age || ''} onChange={(e) => setForm({ ...form, tranche_age: e.target.value })} />
      <SelectInput label="Situation professionnelle" options={jobOptions} value={form.situation_professionnelle || ''} onChange={(e) => setForm({ ...form, situation_professionnelle: e.target.value })} />
      <SelectInput label="Habitudes de sortie" options={outingOptions} value={form.habitudes_sortie || ''} onChange={(e) => setForm({ ...form, habitudes_sortie: e.target.value })} />
      <label className="field"><span>Suggestion</span><textarea value={form.suggestion || ''} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} /></label>
    </div>
  </section>;
}

function PublicProgramForm({ type }) {
  const isBons = type === 'bons';
  const [form, setForm] = useState({ centres_interet: [], consentement_email: false });
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const hasWhatsapp = Boolean((form.whatsapp || '').trim());
    const hasSmsFallback = !hasWhatsapp && Boolean((form.telephone_principal || '').trim());
    if (!hasWhatsapp && !hasSmsFallback) return setError('Merci d’indiquer votre WhatsApp, ou votre téléphone si vous n’avez pas WhatsApp.');
    if (form.consentement_email && !form.email) return setError('Merci d’indiquer votre e-mail pour recevoir aussi les offres par e-mail.');
    const marketing_consent = [
      hasWhatsapp ? 'whatsapp' : 'sms',
      form.consentement_email ? 'email' : null
    ].filter(Boolean);
    try {
      const data = await api(`/public/${isBons ? 'bons-voisins' : 'fidelite'}`, { method: 'POST', body: JSON.stringify({ ...form, marketing_consent }) });
      setDone(data.message);
    } catch (err) {
      setError(err.message);
    }
  };
  if (done) return <PublicShell><Success message={done} /></PublicShell>;
  return <PublicShell><form className="form-card" onSubmit={submit}>
    <h2>{isBons ? 'Les Bons Voisins de La Résidence' : 'Programme de fidélité La Résidence'}</h2>
    <p className="intro">{isBons ? 'Vous habitez ou travaillez près de La Résidence ?\nInscrivez-vous gratuitement aux Bons Voisins de La Résidence et recevez nos offres dédiées au quartier.\n\nVotre offre de bienvenue :\n1 café ou thé offert avec son biscuit maison ☕🍪 lors de votre prochaine visite.' : 'Inscrivez-vous au programme de fidélité de La Résidence pour faire suivre vos passages et vos achats éligibles.\n\nAprès 10 passages, un cadeau vous attend.\nVos achats cumulés pourront aussi vous permettre d’atteindre des super bonus.'}</p>
    <div className="grid two">
      <TextInput label="Nom et prénom" required value={form.nom_prenom || ''} onChange={(e) => setForm({ ...form, nom_prenom: e.target.value })} />
      <TextInput label="WhatsApp (prioritaire)" value={form.whatsapp || ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      <TextInput label="Téléphone SMS si vous n’avez pas WhatsApp" value={form.telephone_principal || ''} onChange={(e) => setForm({ ...form, telephone_principal: e.target.value })} />
      <TextInput label="E-mail facultatif" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <TextInput label="Quartier ou lieu de travail" required value={form.quartier_ou_lieu_travail || ''} onChange={(e) => setForm({ ...form, quartier_ou_lieu_travail: e.target.value })} />
      {isBons && <SelectInput label="Type de contact" required options={['habitant du quartier', 'travailleur dans le quartier', 'les deux', 'client de passage', 'autre']} value={form.type_contact || ''} onChange={(e) => setForm({ ...form, type_contact: e.target.value })} />}
      <CheckboxGroup label="Centres d’intérêt *" values={interests} selected={form.centres_interet} onChange={(centres_interet) => setForm({ ...form, centres_interet })} />
    </div>
    <OptionalProfile form={form} setForm={setForm} />
    <section className="form-section">
      <h3>Canal utilisé pour les offres</h3>
      <p>Nous utilisons WhatsApp en priorité. Si vous n’avez pas WhatsApp, indiquez votre téléphone principal : le SMS sera utilisé uniquement dans ce cas.</p>
      <label className="check wide"><input type="checkbox" checked={Boolean(form.consentement_email)} onChange={(e) => setForm({ ...form, consentement_email: e.target.checked })} />Recevoir aussi les informations par e-mail</label>
      <p className="consent-note">{channelConsentText}</p>
    </section>
    {error && <p className="error">{error}</p>}
    <Button><ShieldCheck size={18} />Valider mon inscription</Button>
  </form></PublicShell>;
}

function DemandForm({ type }) {
  const [form, setForm] = useState({ offres: [], marketing_consent: [] });
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const brunchOptions = useMemo(() => getBrunchOptions(), []);
  const label = type.replaceAll('-', ' ');
  const splitPeople = peopleSplitTypes.includes(type);
  const peopleTotal = Number(form.nombre_adultes || 0) + Number(form.nombre_enfants || 0);
  const kind = ['brunch', 'soiree', 'moments-conviviaux', 'evenement', 'anniversaire', 'piscine'].includes(type) ? 'event'
    : type === 'chambre' ? 'room'
    : ['seminaire', 'reception', 'salle'].includes(type) ? 'hall'
    : 'food';
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (splitPeople && peopleTotal <= 0) {
      setError('Merci d’indiquer au moins un adulte ou un enfant.');
      return;
    }
    if (!form.canal_reponse_prefere) {
      setError('Merci de choisir comment vous souhaitez être recontacté(e).');
      return;
    }
    if (form.canal_reponse_prefere === 'WhatsApp' && !form.whatsapp) {
      setError('Merci d’indiquer votre numéro WhatsApp pour être recontacté(e) par WhatsApp.');
      return;
    }
    if (form.canal_reponse_prefere === 'E-mail' && !form.email) {
      setError('Merci d’indiquer votre e-mail pour être recontacté(e) par e-mail.');
      return;
    }
    if (form.canal_reponse_prefere === 'Appel téléphonique' && !form.telephone_principal) {
      setError('Merci d’indiquer votre téléphone pour être recontacté(e) par appel.');
      return;
    }
    if (form.marketing_consent.includes('whatsapp') && !form.whatsapp) {
      setError('Merci d’indiquer votre numéro WhatsApp pour recevoir les offres par WhatsApp.');
      return;
    }
    if (form.marketing_consent.includes('email') && !form.email) {
      setError('Merci d’indiquer votre e-mail pour recevoir les offres par e-mail.');
      return;
    }
    if (form.marketing_consent.includes('sms') && form.whatsapp) {
      setError('Le SMS est prévu seulement si vous n’avez pas WhatsApp. Gardez WhatsApp pour les offres, ou retirez le numéro WhatsApp.');
      return;
    }
    if (form.marketing_consent.includes('sms') && !form.telephone_principal) {
      setError('Merci d’indiquer votre téléphone pour recevoir les offres par SMS.');
      return;
    }
    try {
      const selectedBrunch = brunchOptions.find((option) => option.value === form.date_souhaitee);
      const data = await api(`/public/demande/${type}`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          ...(splitPeople ? { total_personnes: peopleTotal } : {}),
          ...(type === 'brunch' ? { date_souhaitee_label: selectedBrunch?.label || form.date_souhaitee } : {}),
          type_demande_label: label
        })
      });
      setDone(data.message);
    } catch (err) {
      setError(err.message);
    }
  };
  if (done) return <PublicShell><Success message={done} /></PublicShell>;
  return <PublicShell><form className="form-card" onSubmit={submit}>
    <h2>Demande {label}</h2>
    <p className="intro">Votre demande sera transmise à l’équipe de La Résidence. Nous vous recontacterons selon le canal que vous choisissez.</p>
    <div className="grid two">
      <TextInput label="Nom et prénom" required value={form.nom_prenom || ''} onChange={(e) => setForm({ ...form, nom_prenom: e.target.value })} />
      <TextInput label="WhatsApp (prioritaire)" value={form.whatsapp || ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      <TextInput label="Téléphone principal / SMS si pas de WhatsApp" value={form.telephone_principal || ''} onChange={(e) => setForm({ ...form, telephone_principal: e.target.value })} />
      <TextInput label="E-mail" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      {kind === 'room' && <><TextInput label="Date d’arrivée" required type="date" value={form.date_arrivee || ''} onChange={(e) => setForm({ ...form, date_arrivee: e.target.value })} /><TextInput label="Date de départ" required type="date" value={form.date_depart || ''} onChange={(e) => setForm({ ...form, date_depart: e.target.value })} /><TextInput label="Nombre de personnes" required type="number" min="1" value={form.nombre_personnes || ''} onChange={(e) => setForm({ ...form, nombre_personnes: e.target.value })} /><TextInput label="Type de chambre souhaité" value={form.type_chambre_souhaite || ''} onChange={(e) => setForm({ ...form, type_chambre_souhaite: e.target.value })} /></>}
      {kind === 'hall' && <><TextInput label="Type d’événement" required value={form.type_evenement || ''} onChange={(e) => setForm({ ...form, type_evenement: e.target.value })} /><TextInput label="Date souhaitée" required type="date" value={form.date_souhaitee || ''} onChange={(e) => setForm({ ...form, date_souhaitee: e.target.value })} /><TextInput label="Nombre de personnes" required type="number" min="1" value={form.nombre_personnes || ''} onChange={(e) => setForm({ ...form, nombre_personnes: e.target.value })} /><CheckboxGroup label="Besoins" values={['salle', 'repas', 'pause-café', 'hébergement', 'autre']} selected={form.besoins || []} onChange={(besoins) => setForm({ ...form, besoins })} /></>}
      {kind === 'event' && <>{type === 'brunch' ? <><SelectInput label="Choisissez une date de brunch" required options={brunchOptions.map((option) => option.label)} value={brunchOptions.find((option) => option.value === form.date_souhaitee)?.label || ''} onChange={(e) => { const option = brunchOptions.find((item) => item.label === e.target.value); setForm({ ...form, date_souhaitee: option?.value || '', brunch_date_precision: '' }); }} />{form.date_souhaitee === otherBrunchDate && <TextInput label="Précisez votre demande" required value={form.brunch_date_precision || ''} onChange={(e) => setForm({ ...form, brunch_date_precision: e.target.value })} />}</> : <TextInput label="Date souhaitée" required type="date" value={form.date_souhaitee || ''} onChange={(e) => setForm({ ...form, date_souhaitee: e.target.value })} />}{splitPeople ? <><TextInput label="Nombre d’adultes" required type="number" min="0" value={form.nombre_adultes || ''} onChange={(e) => setForm({ ...form, nombre_adultes: e.target.value })} /><TextInput label="Nombre d’enfants" required type="number" min="0" value={form.nombre_enfants || ''} onChange={(e) => setForm({ ...form, nombre_enfants: e.target.value })} /><p className="total-hint wide">Total personnes : {peopleTotal}</p></> : <TextInput label="Nombre de personnes" required type="number" min="1" value={form.nombre_personnes || ''} onChange={(e) => setForm({ ...form, nombre_personnes: e.target.value })} />}</>}
      {kind === 'food' && <><TextInput label="Date souhaitée" required type="date" value={form.date_souhaitee || ''} onChange={(e) => setForm({ ...form, date_souhaitee: e.target.value })} /><TextInput label="Horaire souhaité" required type="time" value={form.horaire_souhaite || ''} onChange={(e) => setForm({ ...form, horaire_souhaite: e.target.value })} /><SelectInput label="Mode" required options={['sur place', 'à emporter']} value={form.mode || ''} onChange={(e) => setForm({ ...form, mode: e.target.value })} /></>}
      <label className="field wide"><span>Message ou précision</span><textarea value={form.message_precision || ''} onChange={(e) => setForm({ ...form, message_precision: e.target.value })} /></label>
    </div>
    <section className="form-section">
      <h3>Comment souhaitez-vous être recontacté(e) concernant votre demande ?</h3>
      <SelectInput label="Canal de réponse préféré" required options={['WhatsApp', 'E-mail', 'Appel téléphonique', 'Autre']} value={form.canal_reponse_prefere || ''} onChange={(e) => setForm({ ...form, canal_reponse_prefere: e.target.value })} />
    </section>
    <section className="form-section">
      <h3>Souhaitez-vous recevoir nos offres et informations ?</h3>
      <p>Ce choix concerne uniquement les offres marketing. WhatsApp reste le canal principal ; le SMS est proposé seulement si vous n’avez pas WhatsApp.</p>
      <ChoiceGroup label="Choix marketing" choices={[
        { value: 'whatsapp', label: 'Oui, par WhatsApp' },
        { value: 'email', label: 'Oui, par e-mail' },
        { value: 'sms', label: 'Je n’ai pas WhatsApp, oui par SMS' },
        { value: 'non', label: 'Non merci, uniquement pour cette demande' }
      ]} selected={form.marketing_consent} exclusiveValue="non" onChange={(marketing_consent) => setForm({ ...form, marketing_consent })} />
    </section>
    {error && <p className="error">{error}</p>}
    <Button><ClipboardList size={18} />Envoyer ma demande et valider mes choix</Button>
  </form></PublicShell>;
}

function Success({ message }) {
  return <div className="form-card success"><BadgeCheck size={40} /><p>{message}</p></div>;
}

function AdminLayout({ navigate, children }) {
  const user = JSON.parse(localStorage.getItem('lr_user') || '{}');
  const logout = () => {
    localStorage.removeItem('lr_token');
    localStorage.removeItem('lr_user');
    navigate('/admin/login');
  };
  return <main className="admin-shell">
    <aside className="sidebar">
      <h2>La Résidence</h2>
      <p>{user.name}<br /><small>{user.role}</small></p>
      <button onClick={() => navigate('/admin')}><Sparkles size={18} />Tableau de bord</button>
      <button onClick={() => navigate('/admin/contacts')}><UserRound size={18} />Contacts</button>
      <button onClick={() => navigate('/admin/imports/sondage-moments-conviviaux')}><Upload size={18} />Import sondage</button>
      <button onClick={() => navigate('/admin/exports')}><Download size={18} />Exports</button>
      <button onClick={() => navigate('/admin/liens-whatsapp')}><MessageCircle size={18} />Liens WhatsApp</button>
      <button onClick={() => navigate('/admin/offres')}><Gift size={18} />Offres</button>
      <button onClick={logout}><LogOut size={18} />Déconnexion</button>
    </aside>
    <section className="admin-content">{children}</section>
  </main>;
}

function Login({ navigate }) {
  const [form, setForm] = useState({ email: 'admin@laresidence.mg', password: 'admin123' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('lr_token', data.token);
      localStorage.setItem('lr_user', JSON.stringify(data.user));
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    }
  };
  return <PublicShell><form className="form-card login" onSubmit={submit}>
    <h2>Connexion admin</h2>
    <TextInput label="Email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
    <TextInput label="Mot de passe" required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
    {error && <p className="error">{error}</p>}
    <Button><ShieldCheck size={18} />Se connecter</Button>
  </form></PublicShell>;
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api('/admin/dashboard').then(setStats).catch(console.error); }, []);
  const items = stats ? [
    ['Contacts', stats.total_contacts], ['Nouveaux cette semaine', stats.nouveaux_semaine], ['Bons Voisins', stats.bons_voisins],
    ['Fidélité', stats.fidelite], ['Plat du jour', stats.plat_du_jour], ['Pizza', stats.pizza], ['Piscine', stats.piscine],
    ['Chambres', stats.chambres], ['Salles', stats.salles], ['Désinscrits', stats.desinscrits],
    ['Cadeaux disponibles', stats.cadeaux_disponibles], ['Super bonus disponibles', stats.super_bonus_disponibles], ['Offres actives', stats.offres_actives]
  ] : [];
  return <><Header title="Tableau de bord" /><div className="stats">{items.map(([label, value]) => <div className="stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></>;
}

function Header({ title, children }) {
  return <div className="admin-header"><h1>{title}</h1>{children}</div>;
}

function Contacts({ navigate }) {
  const [rows, setRows] = useState([]);
  const [tags, setTags] = useState([]);
  const [filters, setFilters] = useState({});
  const qs = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const interestsTags = tags.filter((tag) => tag.category === 'interet');
  const programTags = tags.filter((tag) => tag.category === 'programme');
  const commercialTags = tags.filter((tag) => tag.category === 'statut_commercial');
  useEffect(() => { api(`/admin/contacts?${qs}`).then(setRows).catch(console.error); }, [qs]);
  useEffect(() => { api('/admin/tags').then(setTags).catch(console.error); }, []);
  return <><Header title="Contacts"><Button variant="secondary" onClick={() => navigate('/admin/contacts/nouveau')}><Plus size={18} />Créer</Button></Header>
    <div className="filters">
      <label><Search size={16} /><input placeholder="Recherche nom, WhatsApp, quartier" value={filters.q || ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
      <select value={filters.interet || ''} onChange={(e) => setFilters({ ...filters, interet: e.target.value })}><option value="">Centre d’intérêt</option>{interestsTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}</select>
      <select value={filters.programme || ''} onChange={(e) => setFilters({ ...filters, programme: e.target.value })}><option value="">Programme</option>{programTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}</select>
      <select value={filters.statut_commercial || ''} onChange={(e) => setFilters({ ...filters, statut_commercial: e.target.value })}><option value="">Statut commercial</option>{commercialTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}</select>
      <select value={filters.source || ''} onChange={(e) => setFilters({ ...filters, source: e.target.value })}><option value="">Source</option><option>Sondage Moments Conviviaux</option><option>demande</option><option>bons-voisins</option><option>fidelite</option><option>admin</option></select>
      <select value={filters.preference_creneau || ''} onChange={(e) => setFilters({ ...filters, preference_creneau: e.target.value })}><option value="">Préférence créneau</option>{momentsSlotOptions.map((slot) => <option key={slot}>{slot}</option>)}</select>
      <select value={filters.statut || ''} onChange={(e) => setFilters({ ...filters, statut: e.target.value })}><option value="">Statut fiche</option><option>actif</option><option>désinscrit</option><option>doublon</option><option>à vérifier</option></select>
      <select value={filters.consentement || ''} onChange={(e) => setFilters({ ...filters, consentement: e.target.value })}><option value="">Consentement</option><option value="oui">actif</option><option value="non">non actif</option></select>
      <select value={filters.cadeau || ''} onChange={(e) => setFilters({ ...filters, cadeau: e.target.value })}><option value="">Cadeau</option><option value="oui">disponible</option></select>
      <select value={filters.super_bonus || ''} onChange={(e) => setFilters({ ...filters, super_bonus: e.target.value })}><option value="">Super bonus</option><option value="oui">disponible</option></select>
    </div>
    <div className="table-wrap"><table><thead><tr><th>Nom</th><th>WhatsApp</th><th>Quartier</th><th>Étiquettes</th><th>Source</th><th>Consentement</th><th>Statut</th><th>Fidélité</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => navigate(`/admin/contacts/${row.id}`)}><td>{row.nom_prenom}</td><td>{row.whatsapp}</td><td>{row.quartier_ou_lieu_travail}</td><td><TagGroups tags={row.tags_detail || row.tags} compact /></td><td>{row.source_formulaire}</td><td>{row.consentement_actif ? 'Oui' : 'Non'}</td><td>{row.statut}</td><td>{row.passages_cycle || 0} passages • {row.montant_cumule_total || 0} Ar</td></tr>)}</tbody></table></div>
  </>;
}

function TagList({ tags = [] }) {
  return <div className="tag-list">{tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}{tags.length > 5 && <span>+{tags.length - 5}</span>}</div>;
}

function TagGroups({ tags = [], compact = false }) {
  const normalized = tags.map((tag) => typeof tag === 'string' ? { name: tag, category: 'autre' } : tag);
  const groups = [
    ['programme', 'Programmes'],
    ['interet', 'Centres d’intérêt'],
    ['statut_commercial', 'Statut commercial'],
    ['gestion', 'Gestion']
  ];
  return <div className={compact ? 'tag-groups compact' : 'tag-groups'}>{groups.map(([category, label]) => {
    const items = normalized.filter((tag) => tag.category === category);
    if (!items.length) return null;
    return <div className="tag-group" key={category}><strong>{label}</strong><TagList tags={items.map((tag) => tag.name)} /></div>;
  })}</div>;
}

function ContactDetail({ id }) {
  const [contact, setContact] = useState(null);
  const [purchase, setPurchase] = useState({ date: new Date().toISOString().slice(0, 10), achat_particulier: true });
  const [mode, setMode] = useState('STOP WhatsApp');
  const load = () => api(`/admin/contacts/${id}`).then(setContact).catch(console.error);
  useEffect(load, [id]);
  if (!contact) return <p>Chargement…</p>;
  const action = (path, body = {}) => api(`/admin/contacts/${id}${path}`, { method: 'POST', body: JSON.stringify(body) }).then(load).catch((err) => alert(err.message));
  return <><Header title={contact.nom_prenom}><Button variant="secondary" onClick={() => navigator.clipboard?.writeText(contact.whatsapp)}><Phone size={18} />Copier WhatsApp</Button></Header>
    <div className="detail-grid">
      <Panel title="Informations principales"><Info label="WhatsApp" value={contact.whatsapp} /><Info label="Téléphone" value={contact.telephone_principal} /><Info label="E-mail" value={contact.email} /><Info label="Canal réponse préféré" value={contact.canal_reponse_prefere} /><Info label="Quartier" value={contact.quartier_ou_lieu_travail} /><Info label="Type" value={contact.type_contact} /><Info label="Source" value={contact.source_formulaire} /><Info label="Date inscription" value={contact.date_inscription?.slice(0, 10)} /><TagGroups tags={contact.tags || []} /></Panel>
      <Panel title="Consentements marketing"><Info label="Statut contact" value={contact.statut_contact || contact.statut} /><Info label="WhatsApp" value={contact.consentement_whatsapp ? 'Oui' : 'Non'} /><Info label="E-mail" value={contact.consentement_email ? 'Oui' : 'Non'} /><Info label="SMS" value={contact.consentement_sms ? 'Oui' : 'Non'} /><Info label="Texte accepté" value={contact.texte_consentement_accepte} /><div className="inline-form"><select value={mode} onChange={(e) => setMode(e.target.value)}><option>STOP WhatsApp</option><option>réception</option><option>téléphone</option><option>autre</option></select><Button variant="danger" onClick={() => action('/unsubscribe', { mode })}>Ne plus contacter</Button></div></Panel>
      <Panel title="Bons Voisins"><Info label="Offre disponible" value={contact.offre_bienvenue_disponible ? 'Oui' : 'Non'} /><Info label="Offre utilisée" value={contact.offre_bienvenue_utilisee ? 'Oui' : 'Non'} /><Button variant="secondary" onClick={() => action('/welcome-used')}>Marquer l’offre de bienvenue comme utilisée</Button></Panel>
      <Panel title="Fidélité"><Loyalty loyalty={contact.loyalty} /><div className="mini-form"><input placeholder="N° facture" value={purchase.invoice_number || ''} onChange={(e) => setPurchase({ ...purchase, invoice_number: e.target.value })} /><input type="number" placeholder="Montant Ar" value={purchase.montant || ''} onChange={(e) => setPurchase({ ...purchase, montant: e.target.value })} /><select value={purchase.activite || ''} onChange={(e) => setPurchase({ ...purchase, activite: e.target.value })}><option value="">Activité</option>{['restaurant', 'brunch', 'pizza', 'goûter', 'piscine', 'chambres', 'événements', 'salles', 'take-away', 'autre'].map((x) => <option key={x}>{x}</option>)}</select><input type="date" value={purchase.date} onChange={(e) => setPurchase({ ...purchase, date: e.target.value })} /><label className="check"><input type="checkbox" checked={purchase.achat_particulier} onChange={(e) => setPurchase({ ...purchase, achat_particulier: e.target.checked })} />Achat particulier</label><Button onClick={() => action('/loyalty/purchase', purchase)}>Ajouter passage + achat</Button><Button variant="secondary" onClick={() => action('/loyalty/reward', { type: 'cadeau' })}>Marquer cadeau remis</Button><Button variant="secondary" onClick={() => action('/loyalty/reward', { type: 'super_bonus' })}>Marquer super bonus remis</Button></div></Panel>
      <Panel title="Historique"><ul className="history">{contact.transactions?.map((tx) => <li key={tx.id}>{tx.date} • {tx.type} • {tx.montant || 0} Ar • {tx.activite || ''}</li>)}{contact.requests?.map((req) => <li key={`r${req.id}`}>{req.created_at?.slice(0, 10)} • demande {req.type_demande}</li>)}</ul></Panel>
      <Panel title="Notes internes"><p>{contact.notes_internes || 'Aucune note.'}</p></Panel>
    </div>
  </>;
}

function Loyalty({ loyalty }) {
  if (!loyalty) return <p>Aucun compte fidélité.</p>;
  return <div className="loyalty">
    <Info label="Passages du cycle" value={`${loyalty.passages_cycle}/10`} />
    <Info label="Prochain cadeau dans" value={loyalty.prochain_cadeau_dans} />
    <Info label="Cadeaux disponibles" value={`${loyalty.cadeaux_disponibles} • Cadeau fidélité à définir`} />
    <Info label="Achats cumulés" value={`${loyalty.montant_cumule_total} Ar`} />
    <Info label="Cycle super bonus" value={`${loyalty.montant_cycle_actuel}/1500000 Ar`} />
    <Info label="Super bonus disponibles" value={`${loyalty.super_bonus_disponibles} • Super bonus à définir`} />
  </div>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function Info({ label, value }) {
  return <p className="info"><span>{label}</span><strong>{value || '—'}</strong></p>;
}

function NewContact({ navigate }) {
  const [form, setForm] = useState({ consentement_actif: true, tags: [] });
  const programOptions = ['Bons Voisins', 'Fidélité'];
  const commercialOptions = ['Nouveau', 'À relancer', 'Prospect chaud', 'Contacté', 'Réservation confirmée', 'Sans suite', 'Client venu'];
  const managementOptions = ['À vérifier', 'VIP', 'Doublon', 'Ne plus contacter'];
  const mergeTagGroup = (values, allowed) => [...form.tags.filter((tag) => !allowed.includes(tag)), ...values];
  const submit = (e) => {
    e.preventDefault();
    api('/admin/contacts', { method: 'POST', body: JSON.stringify(form) }).then((contact) => navigate(`/admin/contacts/${contact.id}`)).catch((err) => alert(err.message));
  };
  return <><Header title="Créer un contact" /><form className="panel admin-form" onSubmit={submit}><TextInput label="Nom et prénom" required value={form.nom_prenom || ''} onChange={(e) => setForm({ ...form, nom_prenom: e.target.value })} /><TextInput label="WhatsApp" required value={form.whatsapp || ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /><TextInput label="Quartier ou lieu de travail" value={form.quartier_ou_lieu_travail || ''} onChange={(e) => setForm({ ...form, quartier_ou_lieu_travail: e.target.value })} /><CheckboxGroup label="Programmes" values={programOptions} selected={form.tags.filter((tag) => programOptions.includes(tag))} onChange={(tags) => setForm({ ...form, tags: mergeTagGroup(tags, programOptions) })} /><CheckboxGroup label="Statut commercial" values={commercialOptions} selected={form.tags.filter((tag) => commercialOptions.includes(tag))} onChange={(tags) => setForm({ ...form, tags: mergeTagGroup(tags, commercialOptions) })} /><CheckboxGroup label="Gestion" values={managementOptions} selected={form.tags.filter((tag) => managementOptions.includes(tag))} onChange={(tags) => setForm({ ...form, tags: mergeTagGroup(tags, managementOptions) })} /><Button>Créer le contact</Button></form></>;
}

function Exports() {
  const [filters, setFilters] = useState({ canal: 'whatsapp' });
  const [tags, setTags] = useState([]);
  const [numbers, setNumbers] = useState('');
  useEffect(() => { api('/admin/tags').then(setTags).catch(console.error); }, []);
  const interestsTags = tags.filter((tag) => tag.category === 'interet');
  const commercialTags = tags.filter((tag) => tag.category === 'statut_commercial');
  const queryParams = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
  const copy = () => api(`/admin/export/whatsapp${query}${query ? '&' : '?'}format=numbers`).then((text) => { setNumbers(text); navigator.clipboard?.writeText(text); });
  const downloadCsv = () => api(`/admin/export/whatsapp${query}`).then((csv) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'export-whatsapp-la-residence.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
  return <><Header title="Exports marketing" /><section className="panel"><p>Les contacts désinscrits, sans consentement pour le canal choisi, sans coordonnée valide ou marqués “Ne plus contacter” sont exclus automatiquement.</p><div className="filters export-filters"><select value={filters.canal || 'whatsapp'} onChange={(e) => setFilters({ ...filters, canal: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="sms">SMS</option></select><select value={filters.interet || ''} onChange={(e) => setFilters({ ...filters, interet: e.target.value })}><option value="">Tous les centres d’intérêt</option>{interestsTags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select><select value={filters.preference_creneau || ''} onChange={(e) => setFilters({ ...filters, preference_creneau: e.target.value })}><option value="">Tous les créneaux</option>{momentsSlotOptions.map((slot) => <option key={slot}>{slot}</option>)}</select><select value={filters.statut_commercial || ''} onChange={(e) => setFilters({ ...filters, statut_commercial: e.target.value })}><option value="">Tous les statuts commerciaux</option>{commercialTags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div><div className="actions"><Button onClick={downloadCsv}>Télécharger CSV</Button><Button variant="secondary" onClick={copy}>Copier la liste</Button></div>{numbers && <textarea className="numbers" readOnly value={numbers} />}</section></>;
}

function SondageImport() {
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const loadFile = async (event) => {
    const file = event.target.files?.[0];
    setReport(null);
    setError('');
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setRows(parsed);
      if (!parsed.length) setError('Aucune ligne lisible dans ce fichier CSV.');
    } catch {
      setRows([]);
      setError('Le fichier CSV n’a pas pu être lu.');
    }
  };
  const importRows = () => {
    setError('');
    api('/admin/imports/sondage-moments-conviviaux', { method: 'POST', body: JSON.stringify({ rows }) })
      .then(setReport)
      .catch((err) => setError(err.message));
  };
  const previewColumns = ['name', 'phone', 'whatsapp', 'wantsWhatsapp', 'accord_whatsapp', 'slot', 'note', 'createdAt'];
  return <><Header title="Import sondage Moments Conviviaux" /><section className="panel">
    <p>Choisissez le CSV exporté depuis le sondage. Un aperçu s’affiche avant l’import.</p>
    <input type="file" accept=".csv,text/csv" onChange={loadFile} />
    {error && <p className="error">{error}</p>}
    {rows.length > 0 && <><h2>Aperçu</h2><div className="table-wrap preview-table"><table><thead><tr>{previewColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={index}>{previewColumns.map((column) => <td key={column}>{row[column] || '-'}</td>)}</tr>)}</tbody></table></div><p>{rows.length} ligne(s) détectée(s).</p><Button onClick={importRows}><Upload size={18} />Importer</Button></>}
    {report && <div className="import-report"><h2>Rapport après import</h2><div className="stats"><div className="stat"><span>Créés</span><strong>{report.created}</strong></div><div className="stat"><span>Mis à jour</span><strong>{report.updated}</strong></div><div className="stat"><span>Ignorés</span><strong>{report.ignored}</strong></div><div className="stat"><span>À vérifier</span><strong>{report.toVerify}</strong></div><div className="stat"><span>Exploitables WhatsApp</span><strong>{report.exportableWhatsapp}</strong></div></div>{report.errors?.length > 0 && <ul className="history">{report.errors.map((item, index) => <li key={index}>Ligne {item.line} : {item.message}</li>)}</ul>}</div>}
  </section></>;
}

function WhatsAppLinks() {
  const [copied, setCopied] = useState('');
  const rows = [
    ['bons-voisins', 'Bons Voisins'],
    ['fidelite', 'Fidélité'],
    ['plat-du-jour', 'Plat du jour'],
    ['pizza', 'Pizza'],
    ['brunch', 'Brunch'],
    ['soiree', 'Soirée'],
    ['piscine', 'Piscine'],
    ['anniversaire', 'Anniversaire'],
    ['chambre', 'Chambre'],
    ['seminaire', 'Séminaire'],
    ['reception', 'Réception'],
    ['moments-conviviaux', 'Moments conviviaux'],
    ['menu-des-voisins', 'Menu des Voisins']
  ];
  const copy = async (type) => {
    const link = buildWhatsAppLink(type);
    await navigator.clipboard?.writeText(link);
    setCopied(type);
  };
  return <><Header title="Liens WhatsApp" /><section className="panel">
    <p>Numéro configuré : <strong>{residenceWhatsappNumber}</strong></p>
    <p>Ces liens sont prêts à copier dans les publications Facebook, Instagram, flyers QR codes ou messages.</p>
    <div className="link-list">{rows.map(([type, label]) => {
      const link = buildWhatsAppLink(type);
      return <article className="link-row" key={type}>
        <div>
          <h2>{label}</h2>
          <p>{whatsappMessages[type]}</p>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </div>
        <div className="link-actions">
          <Button variant="secondary" onClick={() => copy(type)}>Copier</Button>
          <a className="btn primary" href={link} target="_blank" rel="noreferrer">Ouvrir</a>
          {copied === type && <span>Copié</span>}
        </div>
      </article>;
    })}</div>
  </section></>;
}

function Offers() {
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState({ statut: 'brouillon' });
  const load = () => api('/admin/offers').then(setOffers).catch(console.error);
  useEffect(load, []);
  const submit = (e) => {
    e.preventDefault();
    api('/admin/offers', { method: 'POST', body: JSON.stringify(form) }).then(() => { setForm({ statut: 'brouillon' }); load(); });
  };
  return <><Header title="Offres" /><section className="panel"><form className="offer-form" onSubmit={submit}><input required placeholder="Nom de l’offre" value={form.nom_offre || ''} onChange={(e) => setForm({ ...form, nom_offre: e.target.value })} /><input placeholder="Catégorie" value={form.categorie || ''} onChange={(e) => setForm({ ...form, categorie: e.target.value })} /><select value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })}><option>brouillon</option><option>active</option><option>terminée</option><option>archivée</option></select><textarea placeholder="Description" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /><Button>Ajouter</Button></form></section><div className="offer-list">{offers.map((offer) => <section className="panel" key={offer.id}><h2>{offer.nom_offre}</h2><TagList tags={[offer.categorie, offer.statut].filter(Boolean)} /><p>{offer.description}</p></section>)}</div></>;
}

function App() {
  const { path, navigate } = useRoute();
  const token = localStorage.getItem('lr_token');
  if (path === '/' || path === '/bons-voisins') return <PublicProgramForm type="bons" />;
  if (path === '/fidelite') return <PublicProgramForm type="fidelite" />;
  if (path.startsWith('/demande/')) return <DemandForm type={decodeURIComponent(path.split('/').pop())} />;
  if (path === '/admin/login') return <Login navigate={navigate} />;
  if (path.startsWith('/admin') && !token) return <Login navigate={navigate} />;
  if (path === '/admin') return <AdminLayout navigate={navigate}><Dashboard /></AdminLayout>;
  if (path === '/admin/contacts') return <AdminLayout navigate={navigate}><Contacts navigate={navigate} /></AdminLayout>;
  if (path === '/admin/contacts/nouveau') return <AdminLayout navigate={navigate}><NewContact navigate={navigate} /></AdminLayout>;
  if (path.startsWith('/admin/contacts/')) return <AdminLayout navigate={navigate}><ContactDetail id={path.split('/').pop()} /></AdminLayout>;
  if (path === '/admin/imports/sondage-moments-conviviaux') return <AdminLayout navigate={navigate}><SondageImport /></AdminLayout>;
  if (path === '/admin/exports') return <AdminLayout navigate={navigate}><Exports /></AdminLayout>;
  if (path === '/admin/liens-whatsapp') return <AdminLayout navigate={navigate}><WhatsAppLinks /></AdminLayout>;
  if (path === '/admin/offres') return <AdminLayout navigate={navigate}><Offers /></AdminLayout>;
  return <PublicShell><Success message="Page introuvable." /></PublicShell>;
}

createRoot(document.getElementById('root')).render(<App />);
