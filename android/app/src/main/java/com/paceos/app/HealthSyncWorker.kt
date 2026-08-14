package com.paceos.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONObject

class HealthSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
            if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) return Result.success()
            val client = HealthConnectClient.getOrCreate(applicationContext)
            val granted = client.permissionController.getGrantedPermissions()
            if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) return Result.success()
            val payload = HealthConnectReader(applicationContext).read(7)
            applicationContext.getSharedPreferences("pace_health", Context.MODE_PRIVATE)
                .edit().putString("pending_payload", payload.toString()).apply()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE_NAME = "pace-health-connect-sync"
    }
}
