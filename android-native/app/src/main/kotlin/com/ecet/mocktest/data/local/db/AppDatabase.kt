package com.ecet.mocktest.data.local.db

import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import android.content.Context
import com.ecet.mocktest.data.local.db.dao.OutboxDao
import com.ecet.mocktest.data.local.db.dao.QuestionBankDao
import com.ecet.mocktest.data.local.db.entity.CachedQuestionBankEntity
import com.ecet.mocktest.data.local.db.entity.Converters
import com.ecet.mocktest.data.local.db.entity.OutboxSubmissionEntity

@Database(
    entities = [CachedQuestionBankEntity::class, OutboxSubmissionEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun questionBankDao(): QuestionBankDao
    abstract fun outboxDao(): OutboxDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "mocktest.db",
                ).build().also { instance = it }
            }
    }
}
