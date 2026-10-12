package com.ecet.mocktest

import android.app.Application
import com.ecet.mocktest.data.local.SessionManager
import com.ecet.mocktest.data.local.db.AppDatabase
import com.ecet.mocktest.data.remote.ApiService
import com.ecet.mocktest.data.remote.NetworkModule
import com.ecet.mocktest.data.repository.AuthRepository
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.OutboxSyncWorker
import com.ecet.mocktest.util.ConnectivityObserver
import com.google.firebase.auth.FirebaseAuth

/**
 * Deliberately manual DI rather than Hilt/Koin: with no way to run Gradle
 * or an emulator in the environment this was built in, a hand-wired graph
 * is far more likely to actually compile on first real sync than an
 * annotation-processor-based DI framework whose generated code I cannot
 * inspect or fix here. Swap to Hilt later if the team prefers it — nothing
 * else in the app depends on this being manual.
 */
class MockTestApplication : Application() {

    lateinit var sessionManager: SessionManager
        private set
    lateinit var authRepository: AuthRepository
        private set
    lateinit var examRepository: ExamRepository
        private set
    lateinit var connectivityObserver: ConnectivityObserver
        private set
    lateinit var apiService: ApiService
        private set

    override fun onCreate() {
        super.onCreate()

        sessionManager = SessionManager(this)
        connectivityObserver = ConnectivityObserver(this)

        val firebaseAuth = FirebaseAuth.getInstance()
        authRepository = AuthRepository(
            context = this,
            firebaseAuth = firebaseAuth,
            sessionManager = sessionManager,
            webClientId = getString(R.string.web_client_id),
        )

        apiService = NetworkModule.buildApiService()
        val db = AppDatabase.getInstance(this)
        examRepository = ExamRepository(
            api = apiService,
            authRepository = authRepository,
            questionBankDao = db.questionBankDao(),
            outboxDao = db.outboxDao(),
        )

        OutboxSyncWorker.schedulePeriodic(this)
    }
}
