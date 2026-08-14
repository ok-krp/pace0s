package com.paceos.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
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
                if (!granted.containsAll(HealthConnectReader.READ_PERMISSIONS)) sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are missing or were denied").put("status", "permission_missing").toString())
                else if (pendingSync) syncHealthConnect()
            } catch (_: Exception) { sendToWeb(JSONObject().put("ok", false).put("error", "Unable to verify Health Connect permissions").put("status", "error").toString()) }
            finally { pendingSync = false }
        }
    }

    private val blePermissionLauncher = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.all { it }) sendToWeb(JSONObject().put("ok", true).put("status", "bluetooth_permissions_granted").toString())
        else sendToWeb(JSONObject().put("ok", false).put("status", "permission_missing").put("error", "Les permissions Bluetooth sont nécessaires").toString())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reader = HealthConnectReader(this); scheduleBackgroundSync()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true; settings.domStorageEnabled = true; settings.allowFileAccess = false; settings.allowContentAccess = false
            webViewClient = object : WebViewClient() { override fun onPageFinished(view: WebView?, url: String?) { super.onPageFinished(view, url); deliverPendingQueue() } }
            addJavascriptInterface(HealthBridge(), "PaceHealthConnect")
            addJavascriptInterface(BleBridge(), "PaceWatch")
            loadUrl(BuildConfig.PACE_URL)
        }
        setContentView(webView)
    }

    override fun onResume() {
        super.onResume()
        if (::reader.isInitialized) lifecycleScope.launch {
            try {
                if (HealthConnectClient.getSdkStatus(this@MainActivity) == HealthConnectClient.SDK_AVAILABLE) {
                    val client = HealthConnectClient.getOrCreate(this@MainActivity)
                    if (client.permissionController.getGrantedPermissions().containsAll(HealthConnectReader.READ_PERMISSIONS)) syncHealthConnect()
                }
            } catch (_: Exception) { }
        }
    }

    private fun scheduleBackgroundSync() {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(HealthSyncWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    inner class HealthBridge {
        @JavascriptInterface fun requestSync() { runOnUiThread { pendingSync = true; lifecycleScope.launch {
            try {
                if (HealthConnectClient.getSdkStatus(this@MainActivity) != HealthConnectClient.SDK_AVAILABLE) { sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect is unavailable on this device").put("status", "unavailable").toString()); pendingSync=false; return@launch }
                val client=HealthConnectClient.getOrCreate(this@MainActivity); val granted=client.permissionController.getGrantedPermissions(); val required=HealthConnectReader.READ_PERMISSIONS+HealthConnectReader.BACKGROUND_READ_PERMISSION
                if (!granted.containsAll(required)) { sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect permissions are required").put("status", "permission_missing").toString()); permissionLauncher.launch(required) } else syncHealthConnect()
            } catch (_: Exception) { pendingSync=false; sendToWeb(JSONObject().put("ok", false).put("error", "Health Connect synchronization failed").put("status", "error").toString()) }
        } } }
        @JavascriptInterface fun acknowledgeSync(id:String){if(id.isBlank())return;PendingHealthQueue.acknowledge(this@MainActivity,id);deliverPendingQueue()}
        @JavascriptInterface fun getPendingCount():Int=PendingHealthQueue.peek(this@MainActivity).length()
    }

    inner class BleBridge {
        @JavascriptInterface fun requestBluetoothPermissions() {
            if (Build.VERSION.SDK_INT >= 31) blePermissionLauncher.launch(arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT))
        }
        @JavascriptInterface fun connect(address:String,name:String) {
            if (address.isBlank()) { sendToWeb(JSONObject().put("ok",false).put("error","Adresse Bluetooth manquante").toString()); return }
            if (Build.VERSION.SDK_INT >= 31 && (ContextCompat.checkSelfPermission(this@MainActivity,Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this@MainActivity,Manifest.permission.BLUETOOTH_SCAN)!=PackageManager.PERMISSION_GRANTED)) { requestBluetoothPermissions(); return }
            BleSyncStore.saveDevice(this@MainActivity,address,name)
            val i=Intent(this@MainActivity,BleConnectionService::class.java).apply{action=BleConnectionService.ACTION_CONNECT;putExtra(BleConnectionService.EXTRA_ADDRESS,address);putExtra(BleConnectionService.EXTRA_NAME,name)}
            ContextCompat.startForegroundService(this@MainActivity,i)
            sendToWeb(JSONObject().put("ok",true).put("status","starting").put("name",name).toString())
        }
        @JavascriptInterface fun disconnect() { BleSyncStore.clearDevice(this@MainActivity); startService(Intent(this@MainActivity,BleConnectionService::class.java).setAction(BleConnectionService.ACTION_DISCONNECT)); sendToWeb(JSONObject().put("ok",true).put("status","disconnected").toString()) }
        @JavascriptInterface fun pendingCount():Int=BleSyncStore.peek(this@MainActivity).length()
    }

    private fun syncHealthConnect(){lifecycleScope.launch{try{val payload=reader.read(7);if((payload.optJSONArray("samples")?.length()?:0)>0)PendingHealthQueue.enqueue(this@MainActivity,payload);deliverPendingQueue()}catch(_ :Exception){sendToWeb(JSONObject().put("ok",false).put("error","Unable to read Health Connect data").put("status","read_error").toString())}finally{pendingSync=false}}}
    private fun deliverPendingQueue(){if(!::webView.isInitialized)return;val q=PendingHealthQueue.peek(this);for(i in 0 until q.length()){val item=q.optJSONObject(i)?:continue;sendToWeb(JSONObject().put("ok",true).put("queueId",item.optString("id")).put("payload",item.optJSONObject("payload")).put("status","queued_health_connect").toString())}}
    private fun sendToWeb(json:String){val quoted=JSONObject.quote(json);runOnUiThread{webView.evaluateJavascript("window.PaceHealthConnect && window.PaceHealthConnect._receive($quoted)",null)}}
}