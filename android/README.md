# PaceOS Android — Xiaomi / Health Connect

Cette couche native Android est nécessaire pour lire Health Connect. Une PWA/Web Bluetooth seule ne peut pas lire la base Health Connect du téléphone.

## Xiaomi / HyperOS

Dans Mi Fitness :

1. Activer la synchronisation cloud.
2. Ouvrir Profil → Données tierces / Santé (le libellé varie selon le modèle/région).
3. Autoriser les types de données disponibles.
4. Vérifier que les données de la montre sont bien présentes dans Health Connect.

PaceOS ne contacte pas une API Xiaomi privée/non documentée. Il lit les données que Mi Fitness a réellement publiées vers Health Connect.

## Données lues

- pas
- calories actives
- calories totales
- distance
- fréquence cardiaque
- fréquence cardiaque au repos
- sommeil
- exercices / entraînements
- poids

Les données sont conservées avec leur source et un identifiant externe pour éviter les doublons.

## Arrière-plan

Le worker WorkManager tente une synchronisation périodique. Android/Health Connect exige l'autorisation de lecture en arrière-plan pour ce fonctionnement. Sans cette autorisation, PaceOS ne simule rien et synchronise dès que l'application native est ouverte.

## Build

Le workflow GitHub Actions `.github/workflows/android-health-connect.yml` produit un APK debug en artefact. La version Web/PWA existante reste inchangée ; l'application Android est la couche nécessaire pour Health Connect.
