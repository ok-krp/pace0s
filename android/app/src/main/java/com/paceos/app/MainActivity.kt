package com.paceos.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var reader: HealthConnectReader
    private var pendingSync = false

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) {
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@MainActivity)
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                    sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are missing or were denied").put("status", "permission_missing").toString())
                } else if (pendingSync) {
                    syncHealthConnect()
                }
            } catch (e: Exception) {
                sendToWeb(JSONObject().put("ok", false).put("error", e.message ?: "Unable to verify Health Connect permissions").put("status", "error").toString())
            } finally {
                pendingSync = false
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reader = HealthConnectReader(this)
        scheduleBackgroundSync()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = WebViewClient()
            addJavascriptInterface(HealthBridge(), "PaceHealthConnect")
            loadUrl(BuildConfig.PACE_URL)
        }
        setContentView(webView)
    }

    private fun scheduleBackgroundSync() {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(HealthSyncWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    inner class HealthBridge {
        @JavascriptInterface
        fun requestSync() {
            runOnUiThread {
                pendingSync = true
                lifecycleScope.launch {
                    try {
                        val status = HealthConnectClient.getSdkStatus(this@MainActivity)
                        if (status != HealthConnectClient.SDK_AVAILABLE) {
                            sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect is unavailable on this device").put("status", "unavailable").toString())
                            pendingSync = false
                            return@launch
                        }
                        val client = HealthConnectClient.getOrCreate(this@MainActivity)
                        val granted = client.permissionController.getGrantedPermissions()
                        if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                            sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are required").put("status", "permission_missing").toString())
                            permissionLauncher.launch(HealthConnectReader.READ_PERMISSIONS)
                        } else {
                            syncHealthConnect()
                        }
                    } catch (e: Exception) {
                        pendingSync = false
                        sendToWeb(JSONObject().put("ok", false).put("error", e.message ?: "Health Connect error").put("status", "error").toString())
                    }
                }
            }
        }
    }

    private fun syncHealthConnect() {
        lifecycleScope.launch {
            try {
                val payload = reader.read(7)
                val sampleCount = payload.optJSONArray("samples")?.length() ?: 0
                // Keep the latest complete window locally until the authenticated Pace WebView
                // confirms/consumes it. The deterministic external IDs make replay idempotent.
                getSharedPreferences("pace_health", MODE_PRIVATE).edit()
                    .putString("pending_payload", payload.toString())
                    .putLong("pending_at", System.currentTimeMillis())
                    .apply()
                sendToWeb(JSONObject().put("ok", true).put("payload", payload).put("status", "synced_from_health_connect").put("sampleCount", sampleCount).toString())
            } catch (e: Exception) {
                sendToWeb(JSONObject().put("ok", false).put("error", e.message ?: "Health Connect read failed").put("status", "read_error").toString())
            } finally {
                pendingSync = false
            }
        }
    }

    private fun sendToWeb(json: String) {
        val quoted = JSONObject.quote(json)
        runOnUiThread { webView.evaluateJavascript("window.PaceHealthConnect && window.PaceHealthConnect._receive($quoted)", null) }
    }
}
