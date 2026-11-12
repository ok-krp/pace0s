# Audit fonctionnel croisé PaceOS — 12 novembre 2026

## Périmètre et niveau de preuve

Cet audit distingue trois niveaux qui ne doivent pas être confondus :

- **Code présent** : route, écran ou adaptateur retrouvé dans le dépôt.
- **Validation automatisée** : analyse, tests ou compilation exécutés par GitHub Actions / Vercel.
- **Validation sur appareil / compte réel** : interaction réelle avec caméra, Bluetooth, Health Connect/HealthKit, notifications ou deux sessions Supabase authentifiées.

Le dépôt permet les deux premiers niveaux. Les sessions physiques PC/téléphone et la session Supabase de test ne sont pas disponibles dans cette exécution. Aucun résultat n'est donc marqué « validé sur appareil » sans preuve.

## Résumé des validations techniques

| Contrôle | Résultat | Portée exacte |
|---|---|---|
| Build Vercel Preview, commit `d46efe5` | Réussi — READY | Compilation et déploiement Preview, pas test utilisateur connecté |
| TypeScript `tsc --noEmit` | Réussi | Vérification statique du dépôt Web |
| Tests Web | Réussis | AI tool approval, remote domain state, sync scope, pagination, Nutrition, hydration, wallpaper 20 MiB, MCP |
| Lint des points d'entrée IA/Nutrition | Réussi | Lint du périmètre indiqué dans le workflow |
| Flutter analyze | Réussi | Android, Windows, Linux, Apple |
| Flutter tests | Réussis | Android, Windows, Linux, Apple |
| Builds natifs | En cours lors de la rédaction | APK/AAB, Windows, Linux, iOS/macOS |
| Runtime logs Preview | Aucun error/fatal retourné sur la fenêtre récente interrogée | Ne remplace pas un parcours fonctionnel |
| Tests physiques PC / téléphone | Non exécutés | Nécessitent un navigateur/appareil interactif |
| Synchronisation Supabase réelle | Non vérifiée | La CI n'a ni SUPABASE_URL ni clé publique ; preflight explicite « offline/local-only » |

## Production SSR — cause probable de l'incident

Le dernier déploiement Production est sur le commit `dd66333` (11 octobre 2026), avec le verrouillage de dépendances suivant :
- `@tanstack/react-start` : **1.168.60**
- `@tanstack/start-server-core` : **1.169.39**

Ce mélange de versions est suspect. Les notes officielles TanStack indiquent que `.inputValidator()` a été déprécié au sein de la famille 1.168 (1.168.25), puis supprimé en 1.169.0 au profit de `.validator()`. Les erreurs Production observées sont exactement `createServerFn(...).middleware(...).inputValidator is not a function`.

La branche d'audit a un verrouillage plus cohérent :
- `@tanstack/react-start` : **1.169.2**
- `@tanstack/start-server-core` : **1.169.43**

Le build Vercel Preview et le type-check réussissent avec ce verrouillage. **Cause probable, pas encore preuve de correction runtime** : il manque un appel réel et authentifié à une server function sur le Preview afin de vérifier l'initialisation SSR et l'exécution de la validation. Le Preview est protégé par le SSO du projet dans l'outil d'accès actuel.

Référence officielle : [TanStack React Start changelog — 1.168.25 et 1.169.0](https://github.com/TanStack/router/blob/main/packages/react-start/CHANGELOG.md).

## Matrice fonctionnelle PC / téléphone

| Domaine | Web PC | Web mobile | Flutter natif | Priorité / constat |
|---|---|---|---|---|
| Authentification / changement de compte | Route et flux présents | Même application responsive, non testée sur appareil | Écran Auth + tests d'isolation | P1 — parcours réel encore à exécuter |
| Dashboard | Route présente | Responsive non testé | DashboardPage présent | P2 — test tactile / tailles d'écran à faire |
| Nutrition — saisie manuelle | Présente | Non testée sur appareil | NutritionPage présente, FoodLogSync et tests | P1 — valider le cycle complet sur deux sessions réelles |
| Nutrition — analyse photo / ajout IA | Parcours Web présent | Non testée sur appareil | Aucune UI de sélection photo identifiée dans NutritionPage | P1 — parité native absente ou à spécifier |
| Assistant IA / conversations | Assistant et routes IA présentes | Non testés sur appareil | AiPage et PaceAiService présents | P1 — tester avec fournisseur réellement configuré |
| Sport / exercices / séances | Route présente | Non testée sur appareil | SportPage présente | P2 — tests widget / scénario complet à étendre |
| Sommeil | Route présente | Non testé sur appareil | SleepPage présente | P2 — tests de saisie et persistance à étendre |
| Habitudes / routine | Route présente | Non testée sur appareil | RoutinePage présente | P2 |
| Calendrier | Route présente | Non testé sur appareil | CalendarPage présente | P2 |
| Notes | Route présente | Non testées sur appareil | NotesPage présente | P2 |
| Courses | Pas de route dédiée identifiée | — | ShoppingPage présente | P2 — divergence fonctionnelle à clarifier |
| Santé / Health Connect / HealthKit | Sources santé Web présentes | Permissions réelles non testées | HealthPage + NativeHealthAdapter présents | P1 — tester permissions et échantillons réels sur Android/iOS |
| Watch / Bluetooth | Route Watch présente | Non testé sur appareil | L'entrée « Watch & Bluetooth » ouvre actuellement un dialogue d'information, pas un écran de gestion des appareils | P1 — gestion Bluetooth native incomplète |
| Finance | Route présente | Non testée sur appareil | Aucun module natif Finance identifié | P1 — parité fonctionnelle absente |
| Investissements | Route présente | Non testée sur appareil | Aucun module natif identifié | P2 — parité fonctionnelle absente |
| Recettes / rappels | Routes présentes | Non testés sur appareil | Aucun module natif correspondant identifié | P2 — parité fonctionnelle absente |
| Scanner QR / code-barres | Route Scan présente | Caméra non testée | Aucun écran natif Scan identifié | P1 — scanner natif absent |
| Eau / hydratation | Route Water présente | Non testée sur appareil | Données eau manipulées depuis le Dashboard, sans écran natif dédié identifié | P2 |
| Travail / développement / productivité | Routes Work et Development présentes | Non testées sur appareil | Aucun module natif dédié identifié | P2 — parité fonctionnelle absente |
| Profil / poids / données corporelles | Routes Profile et Body présentes | Non testées sur appareil | Poids présent dans les données Dashboard ; pas de pages natives dédiées identifiées | P2 |
| Paramètres / notifications | Paramètres Web détaillés | Permissions push non testées | Paramètres natifs plus réduits ; notifications locales présentes | P1 — parité et permissions à tester |
| Fonds d'écran personnalisés | Import Web jusqu'à 20 MiB, IndexedDB local | Même code Web, non testé physiquement | Aucun écran de fond d'écran natif identifié | P1 — Web corrigé ; parité Flutter à décider |
| Synchronisation multi-appareils | Moteur Web + Realtime / pull | Non testée sur appareil | SyncService + LocalStore + tests d'isolation | P0 — backend réel non exercé ; exige un environnement Supabase isolé |
| Export / réinitialisation | Export local et reset Web présents | Non testés sur appareil | Stockage local persistant présent, scénarios d'export/reset à compléter | P2 |

### Wallpaper: legacy cloud data caveat

New wallpaper selection and image data are now stored only in device-local IndexedDB; both Web and native sync exclude the current and legacy wallpaper keys from pushes and pulls. The code deliberately does **not** delete any pre-existing `user_state` wallpaper row from either live Supabase project. If an old cloud copy exists, it remains untouched and is excluded from subsequent client reconciliation until a separate, explicitly approved cleanup plan is run in the correct isolated/production target.

### Device-local privacy data — synchronization boundary

The cross-platform sync audit found that the previous broad `pace.*` allow rule could send device-bound records into `user_state`. The automatic Web sync engine, the manual Cloud Sync backup/restore buttons, and Flutter push filters now explicitly keep these keys local:
- `pace.privacy.*`: Finance PIN hash, WebAuthn credential ID and local lock preferences.
- `pace.ble.*` and `pace.import.*`: paired-device identifiers, sensor mappings, import dedupe hashes and import history.
- `pace.local-ai.*` and `pace.ai.pending:*`: device-local model state and unsent AI draft text.
- Exact local-only keys: `pace.wallpaper`, `pace.finance.pin.hash`, `pace.ai.debug`, `pace.billing.device_id`, `pace.watch.last_metrics`.

The automatic Web sync engine, manual Cloud Sync restore, and Flutter server-side pull queries also filter canonical and legacy `lt.*` aliases before downloading values, including exact aliases for billing, watch cache, debug and old Finance PIN data. Unit tests cover the syncable-key allow/deny rules in both clients.

No pre-existing `user_state` rows were deleted, and neither connected Supabase project was modified. Historical values already uploaded to a cloud project, if any, remain there until a separate reviewed cleanup is approved. The new client filters prevent further push/pull but do not erase historical cloud copies.

## Corrections livrées dans cette branche

| Correction | Priorité | État |
|---|---|---|
| Limite de fond d'écran de 4 MiB → 20 MiB (20 × 1024 × 1024 octets) | P1 | Commitée |
| Stockage de l'image en Blob dans IndexedDB sur l'appareil, pas en Data URL dans localStorage | P1 | Commitée |
| Migration de l'ancienne préférence locale uniquement après écriture IndexedDB réussie | P1 | Commitée |
| Exclusion `pace.wallpaper` et `lt.wallpaper` des synchronisations Web et Flutter | P1 | Commitée |
| Exclusion serveur des anciens fonds de la réconciliation Web/Flutter pour éviter leur téléchargement | P1 | Commitée |
| Suppression du cache du fond lors du reset local | P1 | Commitée |
| Tests de limite 20 MiB et types de fichiers dans la CI Web | P1 | Passés |
| Test d'exclusion des fonds de la synchronisation native | P1 | Passé |
| Correction du narrowing TypeScript du type WallpaperChoice | P1 | Type-check passé |
| Migration Flutter 3.50 vers le paquet officiel `material_ui` | P2 | Analyze/tests passés |
| Suppression du doublon généré `src/routes/routeTree.gen.ts` qui déclenchait un avertissement de découverte de route | P2 | Supprimé |

## Backlog priorisé

### P0 — Avant toute validation de synchronisation réelle

1. Créer ou restaurer un environnement Supabase isolé avec le schéma/RPC correspondant exactement au commit testé.
2. Configurer uniquement les secrets/variables de cet environnement de test dans CI/Preview.
3. Vérifier connexion, ajout manuel sur PC, lecture sur téléphone, ajout sur téléphone, lecture sur PC, édition, suppression, conflit hors ligne et changement de compte.
4. Mesurer l'egress de test avant/après ; ne pas utiliser l'instance de production pour ce test.

### P1 — Fonctionnalités et parité

1. Terminer le parcours Watch/Bluetooth natif : découverte, permissions, connexion, déconnexion, reprise et mesure réelle.
2. Décider et implémenter la parité native des domaines Finance, Scanner, photo Nutrition IA et des autres fonctions Web prioritaires.
3. Effectuer les tests de permissions Health Connect / HealthKit, appareil photo, notifications et sélection de fichier sur de vrais appareils.
4. Tester les fonds personnalisés de 5, 10, 19 et 20 MiB, le refus au-dessus de 20 MiB, le redémarrage, le cache vidé et le changement de compte.

### P2 — Robustesse et performances

1. Réduire le bundle Web principal (environ 640 KiB non compressés dans le build observé) et découper les modules lourds Nutrition/Graphiques/IA.
2. Ajouter des tests widget dédiés aux pages Flutter Calendar, Notes, Routine, Sleep, Sport, Settings et Shopping.
3. Ajouter des tests E2E Web desktop/mobile avec compte de test isolé et des captures de viewport de référence.
4. Compléter les tests d'accessibilité, clavier mobile, focus, scroll et navigation tactile.

## Garde-fous

- Cette branche est une PR Draft ; aucune fusion n'est demandée.
- Pas de migration, d'écriture de données, de modification RLS ni d'action d'egress sur Supabase Production.
- Pas de déploiement Production ni de changement DNS.
- Les artefacts Vercel cités sont des Preview.


## Corrections added after the first audit pass

- Device-local cleanup now removes both `pace.*` and legacy `lt.*` localStorage keys. It always attempts the localStorage purge even when IndexedDB fails, and returns explicit partial-cleanup errors.
- Account deletion also invokes the device-local cleanup after the server-side deletion succeeds; it no longer leaves the IndexedDB wallpaper behind silently.
- The authenticated data export now covers the verified user-owned AI, health/E2EE, consent, billing, sport, nutrition and profile tables, and pages table reads in 500-row chunks rather than silently stopping at the first REST response page.
- Sport child records without their own `user_id` are exported only through program/session/exercise identifiers fetched from the current user's own parent rows.
- Account deletion explicitly removes legacy user-owned rows from AI tables and other tables without an `auth.users` foreign key before deleting the Auth identity. A failure in any purge blocks Auth deletion so the operation can be retried.
- Refresh-token sessions are globally revoked before account data deletion. Existing access JWTs cannot be revoked before their `exp`; the app must not promise immediate invalidation of already-issued access tokens.

These changes have Web type-check and unit-test coverage. They have **not** been exercised against a real authenticated user in the active Supabase projects; CI has no dedicated isolated Supabase credentials.
