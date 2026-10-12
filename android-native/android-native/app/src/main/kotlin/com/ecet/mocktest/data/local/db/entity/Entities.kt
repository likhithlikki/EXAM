package com.ecet.mocktest.data.local.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.google.gson.Gson
import com.ecet.mocktest.data.remote.QuestionAnswerDto
import com.ecet.mocktest.data.remote.QuestionDto

/**
 * One row per subject's full question bank, cached the first time it's
 * fetched online — mirrors the website's cacheBankForOffline_()/
 * ecet_bankcache_* localStorage keys, so a subject opened once online can
 * be attempted again with zero connectivity, same guarantee the PWA gives.
 */
@Entity(tableName = "cached_question_bank")
data class CachedQuestionBankEntity(
    @PrimaryKey val subjectId: String,
    val questionsJson: String, // List<QuestionDto> serialized — see Converters
    val cachedAtEpochMillis: Long,
)

/**
 * A fully-finished exam result that could not reach the backend yet (no
 * connectivity, or the request failed) — the native equivalent of the
 * website's ecet_outbox. A WorkManager job (OutboxSyncWorker) flushes this
 * whenever connectivity returns; nothing here is ever silently dropped
 * except a request the server explicitly rejected as a duplicate/locked
 * cooldown (see OutboxRepository), which mirrors the website's own
 * "can never succeed by retrying" handling for that exact case.
 */
@Entity(tableName = "outbox_submission")
data class OutboxSubmissionEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val payloadJson: String, // SubmitExamRequest serialized
    val queuedAtEpochMillis: Long,
    val attemptCount: Int = 0,
)

class Converters {
    private val gson = Gson()

    @TypeConverter
    fun questionsToJson(list: List<QuestionDto>): String = gson.toJson(list)

    @TypeConverter
    fun jsonToQuestions(json: String): List<QuestionDto> =
        gson.fromJson(json, Array<QuestionDto>::class.java)?.toList() ?: emptyList()
}
