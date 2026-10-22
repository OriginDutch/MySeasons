// Vaste instellingen. Gevolgde competities staan in Firestore (meta/leagues, zie leagues.js);
// Cambuur is de hoofdclub en 2026 (= 2026-27) is het huidige seizoen.

export const MAIN_CLUB = { id: 358204, name: 'Cambuur', short: 'CAM', city: 'Leeuwarden' };
export const CURRENT_SEASON = 2026;
export const SCHEMA_VERSION = 1;
export const TIME_ZONE = 'Europe/Amsterdam';


// Ranglijstzones en promotieregels staan in rules.js (regelmotor).

// Na zoveel dagen stelt de app voor om het programma opnieuw te synchroniseren.
export const SYNC_SUGGEST_DAYS = 3;
