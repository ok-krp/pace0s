package com.paceos.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateRequest
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import org.json.JSONArray
import org.json.JSONObject

class HealthConnectReader(context: Context) {
    private val client = HealthConnectClient.getOrCreate(context)

    companion object {
        val READ_PERMISSIONS = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(WeightRecord::class),
        )
    }

    suspend fun read(days: Long = 7): JSONObject {
        val zone = ZoneId.systemDefault()
        val now = ZonedDateTime.now(zone)
        val start = now.minusDays(days).toInstant()
        val end = now.toInstant()
        val range = TimeRangeFilter.between(start, end)
        val out = JSONArray()

        val aggregate = client.aggregate(AggregateRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL, DistanceRecord.DISTANCE_TOTAL),
            timeRangeFilter = range,
        ))
        aggregate[StepsRecord.COUNT_TOTAL]?.let { add(out, end, "steps", it.toDouble(), "health_connect", "aggregate:steps:${start.toEpochMilli()}") }
        aggregate[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { add(out, end, "kcal_active", it.inKilocalories, "health_connect", "aggregate:kcal_active:${start.toEpochMilli()}") }
        aggregate[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { add(out, end, "kcal_total", it.inKilocalories, "health_connect", "aggregate:kcal_total:${start.toEpochMilli()}") }
        aggregate[DistanceRecord.DISTANCE_TOTAL]?.let { add(out, end, "distance_m", it.inMeters, "health_connect", "aggregate:distance_m:${start.toEpochMilli()}") }

        client.readRecords(ReadRecordsRequest(HeartRateRecord::class, range)).records.forEach { record ->
            record.samples.forEach { sample -> add(out, sample.time, "heart_rate", sample.beatsPerMinute.toDouble(), origin(record), "heart_rate:${recordId(record)}:${sample.time.toEpochMilli()}") }
        }
        client.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, range)).records.forEach { record ->
            add(out, record.time, "resting_heart_rate", record.beatsPerMinute.toDouble(), origin(record), "resting_hr:${recordId(record)}")
        }
        client.readRecords(ReadRecordsRequest(WeightRecord::class, range)).records.forEach { record ->
            add(out, record.time, "weight_kg", record.weight.inKilograms, origin(record), "weight:${recordId(record)}")
        }
        client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, range)).records.forEach { record ->
            val duration = ChronoUnit.SECONDS.between(record.startTime, record.endTime).toDouble() / 60.0
            out.put(JSONObject().put("ts", record.endTime.toString()).put("type", "sleep_min").put("value", duration).put("source", origin(record)).put("external_id", "sleep:${recordId(record)}").put("start", record.startTime.toString()).put("end", record.endTime.toString()))
        }
        client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, range)).records.forEach { record ->
            val duration = ChronoUnit.SECONDS.between(record.startTime, record.endTime).toDouble() / 60.0
            out.put(JSONObject().put("ts", record.endTime.toString()).put("type", "exercise_duration_min").put("value", duration).put("source", origin(record)).put("external_id", "exercise:${recordId(record)}").put("start", record.startTime.toString()).put("end", record.endTime.toString()).put("exerciseType", record.exerciseType))
        }

        return JSONObject().put("source", "health_connect").put("timezone", zone.id).put("from", start.toString()).put("to", end.toString()).put("samples", out)
    }

    private fun add(out: JSONArray, ts: Instant, type: String, value: Double, source: String, externalId: String) {
        if (value.isFinite()) out.put(JSONObject().put("ts", ts.toString()).put("type", type).put("value", value).put("source", source).put("source_id", source).put("external_id", externalId))
    }

    private fun origin(record: Any): String = try {
        val metadata = record.javaClass.getMethod("getMetadata").invoke(record)
        val dataOrigin = metadata.javaClass.getMethod("getDataOrigin").invoke(metadata)
        dataOrigin.javaClass.getMethod("getPackageName").invoke(dataOrigin) as String
    } catch (_: Exception) { "health_connect" }

    private fun recordId(record: Any): String = try {
        val metadata = record.javaClass.getMethod("getMetadata").invoke(record)
        metadata.javaClass.getMethod("getId").invoke(metadata) as String
    } catch (_: Exception) {
        "${record.javaClass.simpleName}:${record.hashCode()}"
    }
}
