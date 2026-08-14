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
    ) { granted ->
        if (granted.isNotEmpty() && pendingSync) syncHealthConnect()
        else if (granted.isEmpty()) sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions were not granted").toString())
        pendingSync = false
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
                        if (HealthConnectClient.getSdkStatus(this@MainActivity) != HealthConnectClient.SDK_AVAILABLE) {
                            sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect is unavailable on this device").toString())
                            pendingSync = false
                            return@launch
                        }
                        val client = HealthConnectClient.getOrCreate(this@MainActivity)
                        val granted = client.permissionController.getGrantedPermissions()
                        if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) permissionLauncher.launch(HealthConnectReader.READ_PERMISSIONS) else syncHealthConnect()
                    } catch (e: Exception) {
                        pendingSync = false
                        sendToWeb(JSONObject().put("ok", false).put("error", e.message ?: "Health Connect error").toString())
                    }
                }
            }
        }
    }

    private fun syncHealthConnect() {
        lifecycleScope.launch {
            try {
                val pending = getSharedPreferences("pace_health", MODE_PRIVATE).getString("pending_payload", null)
                if (!pending.isNullOrBlank()) sendToWeb(JSONObject().put("ok", true).put("payload", JSONObject(pending)).toString())
                val payload = reader.read(7)
                sendToWeb(JSONObject().put("ok", true).put("payload", payload).toString())
            } catch (e: Exception) {
                sendToWeb(JSONObject().put("ok", false).put("error", e.message ?: "Health Connect read failed").toString())
            }
        }
    }

    private fun sendToWeb(json: String) {
        val quoted = JSONObject.quote(json)
        runOnUiThread { webView.evaluateJavascript("window.PaceHealthConnect && window.PaceHealthConnect._receive($quoted)", null) }
    }
}
