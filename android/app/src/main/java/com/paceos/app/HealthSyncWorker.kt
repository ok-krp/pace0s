package com.paceos.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.permission.HealthPermission.Companion.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
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
            if (!granted.contains(PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)) return Result.success()

            val payload = HealthConnectReader(applicationContext).read(7)
            val sampleCount = payload.optJSONArray("samples")?.length() ?: 0
            if (sampleCount == 0) return Result.success()

            PendingHealthQueue.enqueue(applicationContext, payload)
            Result.success()
        } catch (_: Exception) { Result.retry() }
    }

    companion object { const val UNIQUE_NAME = "pace-health-connect-sync" }
}

/** Durable local queue. Only AES-GCM ciphertext is persisted in SharedPreferences. */
object PendingHealthQueue {
    private const val PREFS = "pace_health"
    private const val QUEUE = "pending_queue"
    private const val KEY_ALIAS = "pace-health-queue-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    @Synchronized
    fun enqueue(context: Context, payload: JSONObject): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = readRaw(prefs)
        val id = UUID.randomUUID().toString()
        val encrypted = QueueCrypto.encrypt(payload.toString())
        current.put(
            JSONObject()
                .put("id", id)
                .put("ciphertext", encrypted.ciphertext)
                .put("iv", encrypted.iv)
                .put("createdAt", System.currentTimeMillis()),
        )
        prefs.edit().putString(QUEUE, current.toString()).commit()
        return id
    }

    @Synchronized
    fun peek(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = readRaw(prefs)
        val result = JSONArray()
        for (i in 0 until current.length()) {
            val item = current.optJSONObject(i) ?: continue
            try {
                val plaintext = QueueCrypto.decrypt(
                    item.getString("ciphertext"),
                    item.getString("iv"),
                )
                result.put(
                    JSONObject()
                        .put("id", item.getString("id"))
                        .put("payload", JSONObject(plaintext))
                        .put("createdAt", item.optLong("createdAt")),
                )
            } catch (_: Exception) {
                // Never return malformed/corrupt queue data to the WebView.
            }
        }
        return result
    }

    @Synchronized
    fun acknowledge(context: Context, id: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = readRaw(prefs)
        val remaining = JSONArray()
        var removed = false
        for (i in 0 until current.length()) {
            val item = current.optJSONObject(i) ?: continue
            if (item.optString("id") == id) removed = true else remaining.put(item)
        }
        if (removed) prefs.edit().putString(QUEUE, remaining.toString()).commit()
        return removed
    }

    private fun readRaw(prefs: android.content.SharedPreferences): JSONArray = try {
        val raw = JSONArray(prefs.getString(QUEUE, "[]") ?: "[]")
        var migrated = false
        for (i in 0 until raw.length()) {
            val item = raw.optJSONObject(i) ?: continue
            val legacyPayload = item.optJSONObject("payload") ?: continue
            val encrypted = QueueCrypto.encrypt(legacyPayload.toString())
            item.remove("payload")
            item.put("ciphertext", encrypted.ciphertext)
            item.put("iv", encrypted.iv)
            migrated = true
        }
        if (migrated) prefs.edit().putString(QUEUE, raw.toString()).commit()
        raw
    } catch (_: Exception) {
        JSONArray()
    }
}

private object QueueCrypto {
    data class Encrypted(val ciphertext: String, val iv: String)

    private fun keyOrCreate(): SecretKey {
        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) return existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun existingKeyOrNull(): SecretKey? {
        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    }

    fun encrypt(plaintext: String): Encrypted {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keyOrCreate())
        return Encrypted(
            Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP),
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
        )
    }

    fun decrypt(ciphertext: String, iv: String): String {
        val key = existingKeyOrNull() ?: throw IllegalStateException("Health queue encryption key is unavailable")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )
        return String(
            cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)),
            Charsets.UTF_8,
        )
    }
}
