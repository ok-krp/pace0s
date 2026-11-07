# Pace Native — Flutter

This directory is the beginning of the real cross-platform Pace application.

It is intentionally parallel to the existing React/TypeScript web application. The web application is not used as the Flutter frontend.

## Runtime rule

The native Flutter application MUST NOT use the Pace website as its UI. In particular, it must not use:

- WebView as the primary UI
- `pace0s.lovable.app`
- `/nutrition` or any Pace web route
- `beforeinstallprompt`
- a remote website as the application shell

The Flutter widgets under `lib/` are compiled into the native application and must be able to start without Internet access.

## Target architecture

```text
Flutter UI
    |
Pace domain/services
    |
Local persistence + offline outbox
    |
Supabase sync when connectivity exists
```

Platform-specific integrations are isolated behind Dart contracts:

- `HealthAdapter` → Health Connect / HealthKit / platform capabilities
- `WatchAdapter` → Bluetooth / platform watch APIs

The existing React application remains the source of currently implemented product behaviour while each domain is progressively reimplemented in Flutter. No web feature is deleted merely because it has not yet been ported.

## Current native milestone

The first native shell contains:

- native Flutter navigation;
- Pace Liquid Glass design foundation;
- native Dashboard shell;
- native Nutrition shell;
- native Sleep shell;
- native Settings shell;
- local JSON persistence initialized before the UI starts;
- platform-independent sync and health/watch contracts;
- Android build generation from Flutter rather than the legacy WebView wrapper.

This is an intentionally incomplete product migration. Feature parity is reached domain-by-domain before the corresponding web implementation is retired.

## Supabase-enabled builds

The native app reads its Supabase endpoint and client key at **compile time**:

- `SUPABASE_URL`: the project's HTTPS URL;
- `SUPABASE_PUBLISHABLE_KEY`: the project's publishable/anon client key.

For a local run, pass both values without committing them into source:

```sh
flutter run --dart-define=SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co --dart-define=SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

For GitHub Actions, configure `SUPABASE_URL` and a public client key under **Repository Settings → Secrets and variables → Actions**. The workflow prefers `SUPABASE_PUBLISHABLE_KEY` and also accepts the legacy `SUPABASE_ANON_KEY` variable/secret as a fallback. Use only the public client key intended for mobile/web clients; **never** put a `service_role` key in a Flutter build or client-side configuration.

If either value is absent, or the configured project hostname does not resolve during the GitHub Actions preflight, CI deliberately builds an offline/local-only artifact and appends `-offline` to the artifact name. The preflight checks DNS before deciding whether to embed the endpoint/key, so a stale URL cannot produce an artifact falsely labelled `-cloud`. When the URL and key are present and the hostname resolves, artifacts may be labelled `-cloud`; this does not prove Auth, RLS, or database queries work. A successful offline build verifies compilation and unit tests, but it does not verify Supabase authentication, RLS, or cross-device sync. If the configured endpoint is unreachable at runtime, the sign-in screen offers **Continuer hors connexion** to open the guest/local store without carrying an authenticated account's local data into guest mode.
