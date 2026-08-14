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

    private val permissionLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@MainActivity)
                val granted = client.permissionController.getGrantedPermissions()
                val missing = HealthConnectReader.READ_PERMISSIONS - granted
                if (missing.isNotEmpty()) {
                    sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are missing or were denied").put("status", "permission_missing").toString())
                } else if (pendingSync) {
                    syncHealthConnect()
                }
            } catch (e: Exception) {
                sendToWeb(JSONObject().put("ok", false).put("error", "Unable to verify Health Connect permissions").put("status", "error").toString())
            } finally { pendingSync = false }
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
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    deliverPendingQueue()
                }
            }
            addJavascriptInterface(HealthBridge(), "PaceHealthConnect")
            loadUrl(BuildConfig.PACE_URL)
        }
        setContentView(webView)
    }

    override fun onResume() {
        super.onResume()
        // Foreground sync does not depend on the background permission and keeps
        // the watch/Health Connect data fresh whenever Pace is reopened.
        if (::reader.isInitialized) {
            lifecycleScope.launch {
                try {
                    if (HealthConnectClient.getSdkStatus(this@MainActivity) == HealthConnectClient.SDK_AVAILABLE) {
                        val client = HealthConnectClient.getOrCreate(this@MainActivity)
                        if (client.permissionController.getGrantedPermissions().containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                            syncHealthConnect()
                        }
                    }
                } catch (_: Exception) { /* diagnostics are surfaced by explicit sync */ }
            }
        }
    }

    private fun scheduleBackgroundSync() {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(HealthSyncWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    inner class HealthBridge {
        @JavascriptInterface fun requestSync() {
            runOnUiThread {
                pendingSync = true
                lifecycleScope.launch {
                    try {
                        if (HealthConnectClient.getSdkStatus(this@MainActivity) != HealthConnectClient.SDK_AVAILABLE) {
                            sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect is unavailable on this device").put("status", "unavailable").toString())
                            pendingSync = false
                            return@launch
                        }
                        val client = HealthConnectClient.getOrCreate(this@MainActivity)
                        val granted = client.permissionController.getGrantedPermissions()
                        if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) {
                            sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are required").put("status", "permission_missing").toString())
                            permissionLauncher.launch(HealthConnectReader.READ_PERMISSIONS + HealthConnectReader.BACKGROUND_READ_PERMISSION)
                        } else {
                            syncHealthConnect()
                        }
                    } catch (_: Exception) {
                        pendingSync = false
                        sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect synchronization failed").put("status", "error").toString())
                    }
                }
            }
        }

        @JavascriptInterface fun acknowledgeSync(id: String) {
            if (id.isBlank()) return
            PendingHealthQueue.acknowledge(this@MainActivity, id)
            deliverPendingQueue()
        }

        @JavascriptInterface fun getPendingCount(): Int = PendingHealthQueue.peek(this@MainActivity).length()
    }

    private fun syncHealthConnect() {
        lifecycleScope.launch {
            try {
                val payload = reader.read(7)
                if ((payload.optJSONArray("samples")?.length() ?: 0) > 0) PendingHealthQueue.enqueue(this@MainActivity, payload)
                deliverPendingQueue()
            } catch (_: Exception) {
                sendToWeb(JSONObject().put("ok", false).put("error", "Unable to read Health Connect data").put("status", "read_error").toString())
            } finally { pendingSync = false }
        }
    }

    private fun deliverPendingQueue() {
        if (!::webView.isInitialized) return
        val queue = PendingHealthQueue.peek(this)
        for (i in 0 until queue.length()) {
            val item = queue.optJSONObject(i) ?: continue
            sendToWeb(JSONObject().put("ok", true).put("queueId", item.optString("id")).put("payload", item.optJSONObject("payload")).put("status", "queued_health_connect").toString())
        }
    }

    private fun sendToWeb(json: String) {
        val quoted = JSONObject.quote(json)
        runOnUiThread { webView.evaluateJavascript("window.PaceHealthConnect && window.PaceHealthConnect._receive($quoted)", null) }
    }
}
