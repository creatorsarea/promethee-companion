# Promethee Companion

Un petit compagnon au-dessus de la barre des taches de Windows qui suit ta session
Promethee en direct, plus **Card Studio** (ouvert au clic sur le compagnon) pour
generer et publier la carte de fin de session en WebP anime.

## Installation

Node 18+ requis.

```
cd companion
npm install
npm start
```

Au premier lancement, l'app s'inscrit au demarrage de Windows (desactivable depuis
l'icone dans la zone de notification).

## Le compagnon

| Etat | Quand | Affichage |
|---|---|---|
| Veille | pas de session (ou session en pause) | il dort, Zzz |
| Focus | session en cours | coucou une fois, box : switch, malus, focus |
| Alerte | tu as quitte ton app | flammes, "Retourne sur <app>" + decompte |

- **Clic** : ouvre Card Studio. **Glisser** : deplace le compagnon (position memorisee).
- **Icone tray** : afficher/masquer, taille (petit/moyen/grand), remettre en bas a
  droite, lancement au demarrage, quitter.
- La fenetre ne prend jamais le focus : Promethee continue de voir ton app.

## Les chiffres

Tout est calcule comme Promethee, a partir de sa DB locale (`promethee.db` + `-wal`,
lue avec sql.js dans un thread a part, seulement quand elle change) :

- **Switch** : segments "durables" (>= 2 captures de 10s), `switch = segments - 1`,
  avec les memes filtres d'apps (explorer, dwm, ...).
- **Malus** : `min(35, switchs par heure x 2)`.
- **Focus** : `100 - malus - idle`, avec `idle = part inactive x 50`. L'inactivite
  n'est pas dans la DB de Promethee : le compagnon l'echantillonne lui-meme toutes les
  15s (meme API, meme seuil de 120s, meme fusion des blocs). Un **!** apparait a cote
  du focus si le compagnon a ete lance apres le debut de la session.
- **Alerte** : la detection de l'app au premier plan (temps reel) sert seulement a
  afficher/cacher l'alerte. Le decompte vise le moment ou Promethee comptera le
  switch (2e capture sur la nouvelle app), exact des que la DB a vu le detour.

## Card Studio

- **Donnees** : derniere session lue dans la DB locale.
- **Emblemes / polices** : lus dans `...\Local\Promethee\app-<derniere version>\resources\assets\`.
- **Token** : lu et dechiffre en local depuis `session.bin` (DPAPI + AES-GCM), jamais
  journalise ni envoye ailleurs. S'il est expire, ouvre Promethee puis reessaie.
- **Publication** : upload du WebP brut (et de sa copie d'affichage `.d.webp` si le grand cote
  depasse 1200 px) puis `publish_feed_session`. "Publier en cache" passe par
  `publish_feed_session_v2` avec l'audience `only_me`, comme l'app pour un post prive avec image.
- **Styles de carte** (liste deroulante) : Classique, Centre (temps de session en grand au milieu,
  embleme du rang en fond, ligue/rang/places/FR sur une ligne) et Compagnon.
- **Pauses** : depuis Promethee 1.3.34, les evenements de fenetre enregistres pendant une pause
  (`sessions.break_log`, plus la pause en cours) sont ignores pour les changements d'app, les
  apps principales et le temps d'appel. Le suivi live fait pareil.
- Places gagnees et FR gagnes ne sont pas dans la DB locale : saisis-les.
- Encodage (`renderer/renderer.js`) : `FPS`, `T`, `QUALITY`. Baisse-les si le fichier
  depasse 8 Mo.
