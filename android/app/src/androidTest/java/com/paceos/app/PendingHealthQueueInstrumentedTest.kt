package com.paceos.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PendingHealthQueueInstrumentedTest {
    private val prefsName = "pace_health"
    private val keyAlias = "pace-health-queue-v1"
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearState()
    }

    @After
    fun tearDown() {
        clearState()
    }

    @Test
    fun enqueuePersistsCiphertextOnlyAndPeekDecrypts() {
        val payload = JSONObject()
            .put("source", "test")
            .put("samples", JSONArray().put(JSONObject().put("type", "steps").put("value", 42)))

        PendingHealthQueue.enqueue(context, payload)

        val raw = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .getString("pending_queue", "") ?: ""
        assertFalse(raw.contains("\"payload\""))
        assertTrue(raw.contains("\"ciphertext\""))
        assertTrue(raw.contains("\"iv\""))
        assertEquals(1, PendingHealthQueue.peek(context).length())
    }

    @Test
    fun acknowledgeRemovesOnlyTheAckedItem() {
        val first = PendingHealthQueue.enqueue(context, JSONObject().put("source", "first").put("samples", JSONArray()))
        val second = PendingHealthQueue.enqueue(context, JSONObject().put("source", "second").put("samples", JSONArray()))

        assertTrue(PendingHealthQueue.acknowledge(context, first))

        val remaining = PendingHealthQueue.peek(context)
        assertEquals(1, remaining.length())
        assertEquals(second, remaining.getJSONObject(0).getString("id"))
    }

    @Test
    fun corruptedItemIsReportedAndOtherItemsRemainDeliverable() {
        PendingHealthQueue.enqueue(context, JSONObject().put("source", "first").put("samples", JSONArray()))
        val second = PendingHealthQueue.enqueue(context, JSONObject().put("source", "second").put("samples", JSONArray()))

        val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        val raw = JSONArray(prefs.getString("pending_queue", "[]"))
        raw.getJSONObject(0).put("ciphertext", "not-valid-base64")
        assertTrue(prefs.edit().putString("pending_queue", raw.toString()).commit())

        val result = PendingHealthQueue.readForDelivery(context)
        assertEquals(1, result.unreadableCount)
        assertFalse(result.keyUnavailable)
        assertEquals(1, result.items.length())
        assertEquals(second, result.items.getJSONObject(0).getString("id"))

        val persisted = JSONArray(prefs.getString("pending_queue", "[]"))
        assertEquals(2, persisted.length())
    }

    @Test
    fun missingKeyIsReportedWithoutDeletingQueue() {
        val id = PendingHealthQueue.enqueue(context, JSONObject().put("source", "key-loss").put("samples", JSONArray()))

        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        keyStore.deleteEntry(keyAlias)

        val result = PendingHealthQueue.readForDelivery(context)
        assertEquals(1, result.unreadableCount)
        assertTrue(result.keyUnavailable)
        assertEquals(0, result.items.length())

        val persisted = JSONArray(
            context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                .getString("pending_queue", "[]"),
        )
        assertEquals(1, persisted.length())
        assertEquals(id, persisted.getJSONObject(0).getString("id"))
    }

    @Test
    fun malformedQueueIsNotCollapsedToAnEmptyQueue() {
        val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        assertTrue(prefs.edit().putString("pending_queue", "{").commit())

        var failed = false
        try {
            PendingHealthQueue.peek(context)
        } catch (_: Exception) {
            failed = true
        }
        assertTrue(failed)
        assertEquals("{", prefs.getString("pending_queue", null))
    }

    @Test
    fun acknowledgePreservesMalformedQueueEntries() {
        val id = PendingHealthQueue.enqueue(
            context,
            JSONObject().put("source", "valid").put("samples", JSONArray()),
        )
        val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        val raw = JSONArray(prefs.getString("pending_queue", "[]"))
        raw.put("unreadable-entry")
        assertTrue(prefs.edit().putString("pending_queue", raw.toString()).commit())

        assertTrue(PendingHealthQueue.acknowledge(context, id))

        val persisted = JSONArray(prefs.getString("pending_queue", "[]"))
        assertEquals(1, persisted.length())
        assertEquals("unreadable-entry", persisted.getString(0))
    }

    @Test
    fun legacyPayloadMigratesToCiphertextAndRemainsReadable() {
        val legacy = JSONArray().put(
            JSONObject()
                .put("id", "legacy-id")
                .put("payload", JSONObject().put("source", "legacy").put("samples", JSONArray()))
                .put("createdAt", 123L),
        )
        val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        assertTrue(prefs.edit().putString("pending_queue", legacy.toString()).commit())

        val result = PendingHealthQueue.readForDelivery(context)
        assertEquals(0, result.unreadableCount)
        assertEquals(1, result.items.length())
        assertEquals("legacy-id", result.items.getJSONObject(0).getString("id"))

        val migrated = JSONArray(prefs.getString("pending_queue", "[]"))
        val item = migrated.getJSONObject(0)
        assertFalse(item.has("payload"))
        assertTrue(item.has("ciphertext"))
        assertTrue(item.has("iv"))
    }

    private fun clearState() {
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply {
                load(null)
                if (containsAlias(keyAlias)) deleteEntry(keyAlias)
            }
        }
    }
}
