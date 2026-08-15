import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class PaceNotificationService {
  PaceNotificationService._();

  static final PaceNotificationService instance = PaceNotificationService._();
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    final darwin = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    final linux = LinuxInitializationSettings(defaultActionName: 'Ouvrir Pace');
    final windows = WindowsInitializationSettings(
      appName: 'Pace',
      appUserModelId: 'com.paceos.pace',
      guid: '7d3f7f6d-2f0f-4db5-9d66-0f7dbe4a9d12',
    );
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: android,
        iOS: darwin,
        macOS: darwin,
        linux: linux,
        windows: windows,
      ),
    );
    _initialized = true;
  }

  Future<bool> requestPermissions() async {
    await initialize();
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final macos = _plugin.resolvePlatformSpecificImplementation<MacOSFlutterLocalNotificationsPlugin>();
    final androidGranted = await android?.requestNotificationsPermission();
    final iosGranted = await ios?.requestPermissions(alert: true, badge: true, sound: true);
    final macosGranted = await macos?.requestPermissions(alert: true, badge: true, sound: true);
    return androidGranted ?? iosGranted ?? macosGranted ?? true;
  }

  Future<void> show({required int id, required String title, required String body, String? payload}) async {
    await initialize();
    const android = AndroidNotificationDetails(
      'pace_default',
      'Pace',
      channelDescription: 'Notifications et rappels Pace',
      importance: Importance.high,
      priority: Priority.high,
    );
    const details = NotificationDetails(
      android: android,
      iOS: DarwinNotificationDetails(),
      macOS: DarwinNotificationDetails(),
      linux: LinuxNotificationDetails(),
      windows: WindowsNotificationDetails(),
    );
    await _plugin.show(id: id, title: title, body: body, notificationDetails: details, payload: payload);
  }

  Future<void> cancel(int id) async {
    await initialize();
    await _plugin.cancel(id: id);
  }

  Future<void> cancelAll() async {
    await initialize();
    await _plugin.cancelAll();
  }
}
