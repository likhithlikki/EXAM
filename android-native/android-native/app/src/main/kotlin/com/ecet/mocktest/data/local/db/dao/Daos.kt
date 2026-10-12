package com.ecet.mocktest.data.local.db.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.ecet.mocktest.data.local.db.entity.CachedQuestionBankEntity
import com.ecet.mocktest.data.local.db.entity.OutboxSubmissionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface QuestionBankDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: CachedQuestionBankEntity)

    @Query("SELECT * FROM cached_question_bank WHERE subjectId = :subjectId LIMIT 1")
    suspend fun get(subjectId: String): CachedQuestionBankEntity?
}

@Dao
interface OutboxDao {
    @Insert
    suspend fun enqueue(entity: OutboxSubmissionEntity): Long

    @Query("SELECT * FROM outbox_submission ORDER BY queuedAtEpochMillis ASC")
    suspend fun getAll(): List<OutboxSubmissionEntity>

    @Query("SELECT COUNT(*) FROM outbox_submission")
    fun countFlow(): Flow<Int>

    @Delete
    suspend fun delete(entity: OutboxSubmissionEntity)

    @Query("UPDATE outbox_submission SET attemptCount = attemptCount + 1 WHERE localId = :localId")
    suspend fun incrementAttempt(localId: Long)
}
