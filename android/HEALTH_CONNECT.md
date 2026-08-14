# Pace Android — Health Connect bridge

Pace uses a native Android layer for Health Connect. The web/PWA must never access Health Connect directly.

## Architecture

Xiaomi Watch / HyperOS -> Mi Fitness -> Health Connect -> Pace Android -> Pace backend/Supabase -> Pace Web/PWA

The native layer is responsible for availability checks, runtime permission checks, Health Connect reads, local pending payloads and forwarding synchronized records to the authenticated Pace web session. It must never synthesize health data.

## Supported records

Steps, distance, active calories, total calories when exposed, exercise sessions, sleep sessions, heart-rate samples, resting heart rate and weight. Only records actually returned by Health Connect are sent.

## Idempotency

Every normalized sample carries a source and an `external_id` where Health Connect exposes a stable record identity. Daily aggregates use a deterministic source/type/day key. The Pace backend deduplicates known external IDs before inserting.

## Offline behavior

Health Connect can be read without Pace network access. The Android layer stores the latest pending payload locally. When the Pace WebView is available again, the payload is forwarded to the authenticated web application, which performs the authenticated server-side upsert. No unauthenticated native write to Supabase is introduced.

## Permissions

Permissions are checked from Health Connect before every sync. Revoked or partial permissions are reported instead of being assumed. Background synchronization additionally requires the Health Connect background-read permission.

## Web/PWA behavior

When running only in a normal browser/PWA, Pace reports that Health Connect requires the native Android application. Bluetooth Watch functionality remains independent and is not replaced by Health Connect.
