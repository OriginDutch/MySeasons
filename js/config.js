// Vaste instellingen. Later komen gevolgde clubs en divisies in Firestore;
// voor nu is Cambuur de hoofdclub en is 2026 (= 2026-27) het huidige seizoen.

export const MAIN_CLUB = { id: 358204, name: 'Cambuur', short: 'CAM' };
export const CURRENT_SEASON = 2026;
export const SCHEMA_VERSION = 1;
export const TIME_ZONE = 'Europe/Amsterdam';

// Bekende Highlightly league-id's (NL betaald voetbal).
export const LEAGUES = {
  75672: 'Eredivisie',
  76523: 'Eerste Divisie',
  77374: 'KNVB Beker',
  568401: 'Oefenwedstrijden',
};

// Na zoveel dagen stelt de app voor om het programma opnieuw te synchroniseren.
export const SYNC_SUGGEST_DAYS = 3;
