package com.paceos.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.*
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.UUID

/** Owns the watch connection independently from the WebView/page lifecycle. */
class BleConnectionService : Service() {
    companion object {
        const val ACTION_CONNECT = "com.paceos.app.BLE_CONNECT"
        const val ACTION_DISCONNECT = "com.paceos.app.BLE_DISCONNECT"
        const val EXTRA_ADDRESS = "address"
        const val EXTRA_NAME = "name"
        const val CHANNEL_ID = "pace_watch"
        const val NOTIFICATION_ID = 4101
        private val HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        private val HR_CHAR = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        private val BAT_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        private val BAT_CHAR = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        private val WEIGHT_SERVICE = UUID.fromString("0000181d-0000-1000-8000-00805f9b34fb")
        private val WEIGHT_CHAR = UUID.fromString("00002a9d-0000-1000-8000-00805f9b34fb")
        private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private var gatt: BluetoothGatt? = null
    private var address: String? = null
    private var deviceName = "Montre"
    private var attempts = 0
    private val handler = Handler(mainLooper)
    private var reconnectRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        // Restore the paired device after process death. START_STICKY alone is
        // insufficient because Android may recreate the service with a null Intent.
        BleSyncStore.device(this)?.let { (savedAddress, savedName) ->
            address = savedAddress
            deviceName = savedName
        }
        startForeground(NOTIFICATION_ID, notification("Connexion de la montre en arrière-plan"))
        if (address != null) handler.post { connect() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                address = intent.getStringExtra(EXTRA_ADDRESS)
                deviceName = intent.getStringExtra(EXTRA_NAME) ?: "Montre"
                if (!address.isNullOrBlank()) {
                    BleSyncStore.saveDevice(this, address!!, deviceName)
                    cancelReconnect()
                    connect()
                }
            }
            ACTION_DISCONNECT -> disconnect(true)
            null -> if (address != null) connect()
        }
        return START_STICKY
    }

    private fun connect() {
        val addr = address ?: return
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            status("permission_missing", "Permission Bluetooth manquante"); return
        }
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: run { status("unavailable", "Bluetooth indisponible"); return }
        val device = try { adapter.getRemoteDevice(addr) } catch (_: Exception) { status("invalid_device", "Adresse Bluetooth invalide"); return }
        gatt?.close()
        status("connecting", "Connexion à $deviceName…")
        gatt = device.connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, statusCode: Int, state: Int) {
            if (state == BluetoothProfile.STATE_CONNECTED) {
                attempts = 0
                cancelReconnect()
                status("connected", "$deviceName connecté")
                if (ActivityCompat.checkSelfPermission(this@BleConnectionService, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) g.discoverServices()
            } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                g.close()
                if (gatt === g) gatt = null
                status("disconnected", "$deviceName déconnecté — reconnexion automatique")
                reconnect()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, statusCode: Int) {
            if (statusCode != BluetoothGatt.GATT_SUCCESS) return
            subscribe(g, HR_SERVICE, HR_CHAR)
            subscribe(g, BAT_SERVICE, BAT_CHAR)
            subscribe(g, WEIGHT_SERVICE, WEIGHT_CHAR)
            status("ready", "$deviceName prêt — synchronisation active")
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) { parse(c.uuid, c.value) }
        @Deprecated("Compatibility") override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) { parse(c.uuid, value) }
    }

    private fun subscribe(g: BluetoothGatt, serviceId: UUID, charId: UUID) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return
        val c = g.getService(serviceId)?.getCharacteristic(charId) ?: return
        if (!g.setCharacteristicNotification(c, true)) return
        val d = c.getDescriptor(CCCD) ?: return
        d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        g.writeDescriptor(d)
    }

    private fun parse(uuid: UUID, b: ByteArray) {
        if (b.isEmpty()) return
        val type: String
        val value: Double
        when (uuid) {
            HR_CHAR -> {
                val f = b[0].toInt() and 255
                val hr = if ((f and 1) == 0) b.getOrNull(1)?.toInt()?.and(255) ?: return
                else if (b.size >= 3) (b[1].toInt() and 255) or ((b[2].toInt() and 255) shl 8) else return
                type = "heart_rate"; value = hr.toDouble()
            }
            BAT_CHAR -> { type = "battery"; value = (b[0].toInt() and 255).toDouble() }
            WEIGHT_CHAR -> { if (b.size < 3) return; val raw = (b[1].toInt() and 255) or ((b[2].toInt() and 255) shl 8); type = "weight"; value = raw * 0.005 }
            else -> return
        }
        val sample = JSONObject().put("ts", System.currentTimeMillis()).put("type", type).put("value", value).put("source", "ble:$deviceName")
        BleSyncStore.enqueue(this, sample)
        sendBroadcast(Intent("com.paceos.app.BLE_SAMPLE").setPackage(packageName).putExtra("sample", sample.toString()))
    }

    private fun reconnect() {
        if (address == null || reconnectRunnable != null) return
        val delay = minOf(60000L, 2000L * (1L shl minOf(attempts, 5)))
        attempts++
        reconnectRunnable = Runnable { reconnectRunnable = null; if (address != null) connect() }
        handler.postDelayed(reconnectRunnable!!, delay)
    }

    private fun cancelReconnect() { reconnectRunnable?.let(handler::removeCallbacks); reconnectRunnable = null }

    private fun disconnect(clear: Boolean) {
        cancelReconnect()
        if (clear) { address = null; BleSyncStore.clearDevice(this) }
        gatt?.disconnect(); gatt?.close(); gatt = null
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Do not disconnect when the user swipes Pace away. Android may still
        // reclaim the service, in which case START_STICKY + saved device restores it.
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() { cancelReconnect(); gatt?.close(); gatt = null; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null

    private fun status(s: String, m: String) {
        sendBroadcast(Intent("com.paceos.app.BLE_STATUS").setPackage(packageName).putExtra("status", s).putExtra("message", m).putExtra("name", deviceName))
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(m))
    }

    private fun notification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .setContentTitle("Pace — Montre")
        .setContentText(text)
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "Connexion montre", NotificationManager.IMPORTANCE_LOW))
    }
}
