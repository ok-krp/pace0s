# Pace Application Architecture

This branch (`application`) is the application track. It starts from the complete `main` codebase and evolves it without deleting working functionality or user data.

## Core rule: one owner per domain

Every mutable domain has one canonical editor page. Dashboard, widgets, charts, AI read models and device dashboards are consumers of that domain; they must not implement a second persistence path.

- Sleep → `/sleep`
- Water → `/water`
- Nutrition → `/nutrition`
- Weight/body → `/body`
- Habits → `/routine`
- Focus/work → `/work`
- Workouts → `/sport`
- Finance → `/finance`
- Calendar → `/calendar`
- Notes → `/notes`
- Health/watch → `/watch`
- Settings → `/settings`

A shortcut may navigate to an owner page. It must not write the domain itself.

## Data flow

```text
UI / Android / future Apple bridge
          ↓
     Domain services
          ↓
   Local durable state
          ↓
     Sync outbox
          ↓
       Supabase
          ↓
   Other Pace clients
```

Reads are allowed from aggregate views. Writes are centralized and idempotent.

## Platform strategy

- Web/PWA remains the primary cross-platform UI.
- Android native code is the privileged bridge for Health Connect and long-lived watch/background capabilities.
- Apple Health requires an iOS-native bridge; the browser must never pretend it has direct HealthKit access.
- Desktop clients consume the same web/core contracts and do not fork domain logic.

## Migration strategy

1. Preserve `main` as the production baseline.
2. Make `application` the progressive application track.
3. Establish domain ownership and remove duplicate editors first.
4. Centralize persistence and synchronization next.
5. Stabilize routing, auth, offline, and cloud recovery.
6. Harden Watch/Health Connect and add platform bridges without mocks.
7. Add AI tools through the same domain services used by the UI.
8. Add automated and production build validation before merging changes back.

## Data safety

Legacy `lt.*` keys are recovery sources. No migration in this branch should delete legacy data automatically. Empty and zero values remain semantically distinct where the domain requires it.
