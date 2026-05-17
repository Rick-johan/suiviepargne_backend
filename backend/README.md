# Backend - Tontine Collaborative

C'est ici que se trouve le "cerveau central" qui permet à plusieurs téléphones de partager les mêmes données pour la grande cagnotte.

## Pourquoi ce choix de Backend (Node.js + Fichier JSON) ?
J'ai choisi une architecture en **Node.js (Express)** couplée à un simple **fichier texte (database.json)**. 

*   **Zéro complexité** : Vous n'avez pas besoin d'installer de gros logiciels de base de données (comme MySQL ou MongoDB). Le serveur crée un simple fichier `.json` et écrit dedans.
*   **Lecture facile** : Puisque la base de données est un fichier `.json`, vous pouvez littéralement l'ouvrir avec le bloc-notes et modifier manuellement les cagnottes si un membre a fait une erreur.
*   **Déploiement hyper facile** : Ce mini-serveur peut être hébergé gratuitement sur des plateformes comme Render, Railway ou même depuis un vieux PC chez vous.

## Comment l'utiliser ?

1. Ouvrez un terminal dans ce dossier `/backend`
2. Installez les dépendances : `npm install`
3. Lancez le serveur : `npm run dev`

Le serveur répondra aux requêtes de votre frontend (ex: Sauvegarder que Marc a payé la semaine 4) sur le port `3000`.

## Prochaines étapes (Si vous décidez de l'utiliser)
Il faudra modifier le fichier `script.js` dans le dossier `/frontend`. 
Au lieu d'utiliser `localStorage.setItem`, on fera des requêtes HTTP (via `fetch()`) pour interroger ce serveur et être sûr de lire la même base de données que tout le monde !
