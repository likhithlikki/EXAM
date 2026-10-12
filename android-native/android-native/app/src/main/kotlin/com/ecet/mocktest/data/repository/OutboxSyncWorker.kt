package com.ecet.mocktest.data.repository

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.ecet.mocktest.MockTestApplication
import java.util.concurrent.TimeUnit

/**
 * Native equivalent of the website's armOutboxAutoSync_(): flushes any exam
 * result that finished offline as soon as the OS tells WorkManager a
 * connected network is available, plus a periodic safety net in case a
 * single connectivity-regained trigger is missed (mirrors the website's own
 * `setInterval(flushOutbox_, 60000)` belt-and-braces retry).
 */
class OutboxSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repo = (applicationContext as MockTestApplication).examRepository
        return try {
            repo.flushOutbox()
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val ONE_TIME_TAG = "outbox_sync_one_time"
        private const val PERIODIC_TAG = "outbox_sync_periodic"

        fun triggerOnce(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONE_TIME_TAG, ExistingWorkPolicy.KEEP, request)
        }

        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = PeriodicWorkRequestBuilder<OutboxSyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_TAG, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
