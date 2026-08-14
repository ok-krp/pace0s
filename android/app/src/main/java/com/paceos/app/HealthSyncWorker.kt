package com.paceos.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class HealthSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
            if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) return Result.success()
            val client = HealthConnectClient.getOrCreate(applicationContext)
            val granted = client.permissionController.getGrantedPermissions()
            if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) return Result.success()
            if (!granted.contains(HealthPermission.READ_HEALTH_DATA_IN_BACKGROUND)) return Result.success()

            val payload = HealthConnectReader(applicationContext).read(7)
            val sampleCount = payload.optJSONArray("samples")?.length() ?: 0
            if (sampleCount == 0) return Result.success()

            PendingHealthQueue.enqueue(applicationContext, payload)
            Result.success()
        } catch (_: Exception) { Result.retry() }
    }

    companion object { const val UNIQUE_NAME = "pace-health-connect-sync" }
}

/** Durable local queue. Items are deleted only after the authenticated WebView ACKs them. */
object PendingHealthQueue {
    private const val PREFS = "pace_health"
    private const val QUEUE = "pending_queue"

    @Synchronized
    fun enqueue(context: Context, payload: JSONObject): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = read(prefs)
        val id = UUID.randomUUID().toString()
        current.put(JSONObject().put("id", id).put("payload", payload).put("createdAt", System.currentTimeMillis()))
        prefs.edit().putString(QUEUE, current.toString()).apply()
        return id
    }

    @Synchronized
    fun peek(context: Context): JSONArray = read(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE))

    @Synchronized
    fun acknowledge(context: Context, id: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = read(prefs)
        val remaining = JSONArray()
        var removed = false
        for (i in 0 until current.length()) {
            val item = current.optJSONObject(i) ?: continue
            if (item.optString("id") == id) removed = true else remaining.put(item)
        }
        if (removed) prefs.edit().putString(QUEUE, remaining.toString()).apply()
        return removed
    }

    private fun read(prefs: android.content.SharedPreferences): JSONArray = try {
        JSONArray(prefs.getString(QUEUE, "[]") ?: "[]")
    } catch (_: Exception) { JSONArray() }
}
