package com.paceos.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import org.json.JSONObject

/** Small native scanner used only to configure the persistent watch service. */
object BleScanner {
    private const val ACTION_RESULT = "com.paceos.app.BLE_SCAN_RESULT"
    private const val ACTION_STATE = "com.paceos.app.BLE_SCAN_STATE"
    private const val SCAN_DURATION_MS = 12_000L
    private var scanner: BluetoothLeScanner? = null
    private var callback: ScanCallback? = null
    private var stopRunnable: Runnable? = null

    fun start(context: Context) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            state(context, "permission_missing", "Permission de recherche Bluetooth manquante"); return
        }
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) { state(context, "unavailable", "Bluetooth désactivé"); return }
        stop(context)
        scanner = adapter.bluetoothLeScanner
        val activeScanner = scanner ?: run { state(context, "unavailable", "Scanner Bluetooth indisponible"); return }
        val seen = mutableSetOf<String>()
        callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device
                val address = device.address ?: return
                if (!seen.add(address)) return
                val name = try { result.scanRecord?.deviceName ?: device.name ?: "Montre Bluetooth" } catch (_: SecurityException) { "Montre Bluetooth" }
                context.sendBroadcast(Intent(ACTION_RESULT).setPackage(context.packageName).putExtra("device", JSONObject().put("address", address).put("name", name).put("rssi", result.rssi).toString()))
            }
            override fun onScanFailed(errorCode: Int) { state(context, "error", "Recherche Bluetooth impossible ($errorCode)") }
        }
        activeScanner.startScan(callback)
        state(context, "scanning", "Recherche de montres…")
        stopRunnable = Runnable { stop(context); state(context, "finished", "Recherche terminée") }
        Handler(Looper.getMainLooper()).postDelayed(stopRunnable!!, SCAN_DURATION_MS)
    }

    fun stop(context: Context) {
        stopRunnable?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        stopRunnable = null
        val activeScanner = scanner
        val activeCallback = callback
        if (activeScanner != null && activeCallback != null && ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
            try { activeScanner.stopScan(activeCallback) } catch (_: Exception) {}
        }
        scanner = null; callback = null
    }

    private fun state(context: Context, status: String, message: String) {
        context.sendBroadcast(Intent(ACTION_STATE).setPackage(context.packageName).putExtra("status", status).putExtra("message", message))
    }
}
