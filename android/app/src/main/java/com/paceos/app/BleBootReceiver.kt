package com.paceos.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BleBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val device = BleSyncStore.device(context) ?: return
        val serviceIntent = Intent(context, BleConnectionService::class.java).apply {
            action = BleConnectionService.ACTION_CONNECT
            putExtra(BleConnectionService.EXTRA_ADDRESS, device.first)
            putExtra(BleConnectionService.EXTRA_NAME, device.second)
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}