export const residenceWhatsappNumber =
  import.meta.env.VITE_RESIDENCE_WHATSAPP_NUMBER || '261340000000';

export const whatsappMessages = {
  'plat-du-jour': 'Bonjour, je suis intéressé(e) par le Plat du Jour des Voisins.',
  pizza: 'Bonjour, je suis intéressé(e) par l’offre Pizza des Bons Voisins.',
  brunch: 'Bonjour, je souhaite des informations pour le brunch.',
  'bons-voisins': 'Bonjour, je souhaite rejoindre Les Bons Voisins de La Résidence.',
  fidelite: 'Bonjour, je souhaite rejoindre le programme de fidélité de La Résidence.',
  soiree: 'Bonjour, je souhaite des informations pour une soirée à La Résidence.',
  piscine: 'Bonjour, je souhaite des informations pour la piscine.',
  anniversaire: 'Bonjour, je souhaite des informations pour un anniversaire à La Résidence.',
  chambre: 'Bonjour, je souhaite des informations pour une chambre à La Résidence.',
  seminaire: 'Bonjour, je souhaite des informations pour un séminaire à La Résidence.',
  reception: 'Bonjour, je souhaite des informations pour une réception à La Résidence.',
  'moments-conviviaux': 'Bonjour, je souhaite des informations sur les moments conviviaux de La Résidence.',
  'menu-des-voisins': 'Bonjour, je suis intéressé(e) par le Menu des Voisins.'
};

export function buildWhatsAppLink(type) {
  const number = String(residenceWhatsappNumber).replace(/[^\d]/g, '');
  const message = whatsappMessages[type] || 'Bonjour, je souhaite des informations auprès de La Résidence.';
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
