// Vaste instellingen. Later komen gevolgde clubs en divisies in Firestore;
// voor nu is Cambuur de hoofdclub en is 2026 (= 2026-27) het huidige seizoen.

export const MAIN_CLUB = { id: 358204, name: 'Cambuur', short: 'CAM', city: 'Leeuwarden' };
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

// Ranglijstzones per competitie, geldig voor seizoen 2026-27 (tickets voor 2027-28).
// Per seizoen nalopen: het aantal Europese plekken hangt af van de UEFA-ranking.
// Eredivisie 2026-27: 1 CL hoofdtoernooi, 2 CL voorronde, 3 EL voorronde,
// 4-7 play-offs om één Conference League-plek, 16 nacompetitie, 17-18 degradatie.
// De bekerwinnaar krijgt een EL-ticket; is die al geplaatst, dan schuift dat door.
export const ZONES = {
  75672: [
    { from: 1, to: 1, kind: 'cl', label: 'Champions League' },
    { from: 2, to: 2, kind: 'clq', label: 'CL-voorronde' },
    { from: 3, to: 3, kind: 'el', label: 'EL-voorronde' },
    { from: 4, to: 7, kind: 'po', label: 'Play-offs Europa' },
    { from: 16, to: 16, kind: 'playoff', label: 'Nacompetitie' },
    { from: 17, to: 18, kind: 'down', label: 'Degradatie' },
  ],
};
export const ZONE_NOTE = {
  75672: 'De bekerwinnaar krijgt een Europa League-ticket. Staat die al bij de eerste drie, dan schuift het ticket door en worden de play-offs 5 t/m 8.',
};

// Na zoveel dagen stelt de app voor om het programma opnieuw te synchroniseren.
export const SYNC_SUGGEST_DAYS = 3;
