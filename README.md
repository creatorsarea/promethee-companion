# Promethee Card Studio

App Electron locale qui lit ta derniere session dans la DB de Promethee, genere
une carte de fin de session en **WebP anime** (emblemes et polices pris dans le
dossier de Promethee), et la publie via l'API.

## Installation

Node 18+ requis.

```
cd promethee-card-studio
npm install
npm start
```

## Fonctionnement

- **Donnees** : lues dans `promethee.db` (+ `-wal`) via sql.js (WASM), donc la
  session que tu viens de terminer est prise meme avant checkpoint SQLite.
- **Emblemes / polices** : lus au runtime dans
  `...\Local\Promethee\app-<derniere version>\resources\assets\` (tiers + fonts).
  La version est resolue automatiquement, donc rien a changer apres une mise a jour.
- **Tier** : non stocke dans la DB, donc selectionnable dans l'interface. Le
  dernier choisi est memorise. Change-le et l'apercu se met a jour aussitot.
- **Token** : lu et dechiffre en local depuis `session.bin` (DPAPI + AES-GCM),
  jamais journalise ni envoye ailleurs. S'il est expire, ouvre Promethee pour le
  rafraichir puis relance.
- **Publication** : upload du WebP brut (pas de canvas cote app = animation
  conservee), puis `publish_feed_session`. La case "publier en cache" utilise
  `publish_feed_session_hidden` (invisible pour les autres), cochee par defaut
  pour les tests.

## Champs a saisir

Places gagnees et FR gagnes ne sont pas dans la DB locale : saisis-les. Le reste
(duree, XP, streak, dates, rang) est pre-rempli.

## Parametres d'encodage

Dans `renderer/renderer.js` : `FPS`, `T` (duree de boucle), `QUALITY`. Baisse-les
si le fichier depasse 8 Mo (limite de l'app).
