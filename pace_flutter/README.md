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
