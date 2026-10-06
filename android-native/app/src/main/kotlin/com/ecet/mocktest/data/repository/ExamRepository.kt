package com.ecet.mocktest.data.repository

import com.ecet.mocktest.data.local.db.dao.OutboxDao
import com.ecet.mocktest.data.local.db.dao.QuestionBankDao
import com.ecet.mocktest.data.local.db.entity.CachedQuestionBankEntity
import com.ecet.mocktest.data.local.db.entity.OutboxSubmissionEntity
import com.ecet.mocktest.data.remote.ApiService
import com.ecet.mocktest.data.remote.AttemptHistoryDto
import com.ecet.mocktest.data.remote.DashboardDto
import com.ecet.mocktest.data.remote.DeleteAccountRequest
import com.ecet.mocktest.data.remote.HomeBundleDto
import com.ecet.mocktest.data.remote.CreateReminderRequest
import com.ecet.mocktest.data.remote.DeleteReminderRequest
import com.ecet.mocktest.data.remote.MistakeDto
import com.ecet.mocktest.data.remote.NotificationDto
import com.ecet.mocktest.data.remote.ProfileDto
import com.ecet.mocktest.data.remote.ReminderDto
import com.ecet.mocktest.data.remote.ReminderMutationResponse
import com.ecet.mocktest.data.remote.RetryNotificationRequest
import com.ecet.mocktest.data.remote.ToggleReminderRequest
import com.ecet.mocktest.data.remote.UpdateReminderRequest
import com.ecet.mocktest.data.remote.QuestionDto
import com.ecet.mocktest.data.remote.SubjectStatusDto
import com.ecet.mocktest.data.remote.SubmitExamRequest
import com.ecet.mocktest.data.remote.SubmitExamResponse
import com.ecet.mocktest.data.remote.SubmitRevisionRequest
import com.ecet.mocktest.data.remote.SubmitRevisionResponse
import com.google.gson.Gson
import kotlinx.coroutines.flow.Flow

sealed class RepoResult<out T> {
    data class Success<T>(val value: T) : RepoResult<T>()
    data class Error(val message: String) : RepoResult<Nothing>()
}

class ExamRepository(
    private val api: ApiService,
    private val authRepository: AuthRepository,
    private val questionBankDao: QuestionBankDao,
    private val outboxDao: OutboxDao,
) {
    private val gson = Gson()

    fun outboxCountFlow(): Flow<Int> = outboxDao.countFlow()

    suspend fun loadHomeBundle(email: String): RepoResult<HomeBundleDto> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.homeBundle(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load home data.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun loadDashboard(email: String): RepoResult<DashboardDto> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.dashboard(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load dashboard.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun loadProfile(email: String): RepoResult<ProfileDto> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.profile(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load profile.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    /**
     * Mirrors the website's gateStartNewAttempt_()/subjectStatus_ pattern:
     * always re-check the LIVE server cooldown state right before starting
     * a fresh attempt, never trust a locally cached "is it locked" value
     * for this specific decision (a stale cache here is exactly the bug
     * the website had to fix — see the "Retry Test bypassing the lock
     * screen" conversation this project's history documents).
     */
    suspend fun checkSubjectLock(email: String, subjectName: String): RepoResult<SubjectStatusDto> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.subjectStatus(email = email, subject = subjectName, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not check subject status.")
        } catch (e: Exception) {
            // Network failure while checking a lock is treated as
            // "unknown, allow" the same way the website does when
            // subjectStatus can't be reached — the ONE place cooldown is
            // actually enforced is server-side in submitExam_, so failing
            // open here cannot bypass the real protection, only the UX
            // pre-check.
            RepoResult.Success(SubjectStatusDto(locked = false))
        }
    }

    /**
     * Cache-first when offline, network-first (and cache-refreshing) when
     * online — same trade-off as the website's loadBankAndEnroll_.
     */
    suspend fun loadQuestions(subjectId: String, isOnline: Boolean): RepoResult<List<QuestionDto>> {
        if (!isOnline) {
            val cached = questionBankDao.get(subjectId)
                ?: return RepoResult.Error("This exam isn't available offline yet. Open it once online first.")
            return RepoResult.Success(gson.fromJson(cached.questionsJson, Array<QuestionDto>::class.java).toList())
        }
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.questions(subjectId = subjectId, idToken = token)
            if (res.ok && res.data != null) {
                questionBankDao.upsert(
                    CachedQuestionBankEntity(
                        subjectId = subjectId,
                        questionsJson = gson.toJson(res.data),
                        cachedAtEpochMillis = System.currentTimeMillis(),
                    ),
                )
                RepoResult.Success(res.data)
            } else {
                RepoResult.Error(res.error?.message ?: "Question bank not available.")
            }
        } catch (e: Exception) {
            // Fall back to cache on a transient network failure too, not
            // only when navigator.onLine-equivalent is false — same
            // resilience the website's offline mode has.
            val cached = questionBankDao.get(subjectId)
            if (cached != null) RepoResult.Success(gson.fromJson(cached.questionsJson, Array<QuestionDto>::class.java).toList())
            else RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    /**
     * Submits an exam. If offline (or the request fails), queues it in the
     * Room outbox instead of losing it — WorkManager's OutboxSyncWorker
     * flushes this automatically once connectivity returns, mirroring the
     * website's queueForOfflineSubmit_()/armOutboxAutoSync_() exactly.
     */
    suspend fun submitExam(request: SubmitExamRequest, isOnline: Boolean): RepoResult<SubmitExamResponse> {
        if (!isOnline) {
            enqueueOffline(request)
            return RepoResult.Error("OFFLINE_QUEUED")
        }
        // The token is fetched HERE, right before the real network call —
        // never trust a token the ViewModel captured earlier (it can be
        // minutes old by the time an exam is finished). The caller always
        // passes an empty idToken; this is the one place it gets filled in.
        val token = authRepository.getIdToken()
        if (token == null) {
            enqueueOffline(request)
            return RepoResult.Error("OFFLINE_QUEUED")
        }
        val signedRequest = request.copy(idToken = token)
        return try {
            val res = api.submitExam(signedRequest)
            if (res.ok) RepoResult.Success(res)
            else if (res.cooldown?.locked == true) RepoResult.Success(res) // let the caller show the "locked" message using res.error, not a generic queue
            else {
                enqueueOffline(signedRequest)
                RepoResult.Error("OFFLINE_QUEUED")
            }
        } catch (e: Exception) {
            enqueueOffline(signedRequest)
            RepoResult.Error("OFFLINE_QUEUED")
        }
    }

    private suspend fun enqueueOffline(request: SubmitExamRequest) {
        outboxDao.enqueue(
            OutboxSubmissionEntity(
                payloadJson = gson.toJson(request),
                queuedAtEpochMillis = System.currentTimeMillis(),
            ),
        )
    }

    suspend fun loadMistakes(email: String): RepoResult<List<MistakeDto>> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.mistakes(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load mistakes.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    /**
     * Revision submission is NOT queued offline (unlike submitExam) — the
     * website's own submitRevisionTest() does not queue it either; a
     * revision test is only ever started from the Mistakes list, which
     * requires a fresh online load in the first place, so there is no
     * offline-start path to mirror here. A network failure simply surfaces
     * as an error the student can retry.
     */
    suspend fun submitRevision(email: String, items: List<com.ecet.mocktest.data.remote.RevisionItemAnswer>): RepoResult<SubmitRevisionResponse> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.submitRevision(SubmitRevisionRequest(idToken = token, email = email, items = items))
            if (res.ok) RepoResult.Success(res) else RepoResult.Error(res.error ?: "Could not submit revision.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun loadHistory(email: String): RepoResult<List<AttemptHistoryDto>> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.history(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load attempt history.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    // ---- Reminders & notifications — standalone, not tied to any specific
    // test, mirroring the website's "Reminders (standalone, not
    // test-dependent)" section exactly. Every mutation re-fetches the full
    // list afterward rather than patching local state, same as the
    // website's saveReminder()/reminderToggle()/reminderDelete() do — the
    // list is small and this keeps client and server from ever drifting. ----

    suspend fun loadReminders(email: String): RepoResult<List<ReminderDto>> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.reminders(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load reminders.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun createReminder(
        email: String,
        userName: String,
        name: String,
        message: String,
        relatedTask: String,
        relatedUrl: String,
        frequency: String,
        nextRunAtIso: String,
    ): RepoResult<ReminderMutationResponse> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.createReminder(
                CreateReminderRequest(idToken = token, email = email, userName = userName, name = name, message = message, relatedTask = relatedTask, relatedUrl = relatedUrl, frequency = frequency, nextRunAt = nextRunAtIso),
            )
            if (res.ok) RepoResult.Success(res) else RepoResult.Error(res.error ?: "Could not save reminder.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun updateReminder(
        email: String,
        id: String,
        userName: String,
        name: String,
        message: String,
        relatedTask: String,
        relatedUrl: String,
        frequency: String,
        nextRunAtIso: String,
    ): RepoResult<ReminderMutationResponse> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.updateReminder(
                UpdateReminderRequest(idToken = token, email = email, id = id, userName = userName, name = name, message = message, relatedTask = relatedTask, relatedUrl = relatedUrl, frequency = frequency, nextRunAt = nextRunAtIso),
            )
            if (res.ok) RepoResult.Success(res) else RepoResult.Error(res.error ?: "Could not save reminder.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun toggleReminder(email: String, id: String, enabled: Boolean): RepoResult<ReminderMutationResponse> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.toggleReminder(ToggleReminderRequest(idToken = token, email = email, id = id, enabled = enabled))
            if (res.ok) RepoResult.Success(res) else RepoResult.Error(res.error ?: "Could not update reminder.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun deleteReminder(email: String, id: String): RepoResult<Unit> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.deleteReminder(DeleteReminderRequest(idToken = token, email = email, id = id))
            if (res.ok) RepoResult.Success(Unit) else RepoResult.Error(res.error ?: "Could not delete reminder.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun loadNotifications(email: String): RepoResult<List<NotificationDto>> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.notifications(email = email, idToken = token)
            if (res.ok && res.data != null) RepoResult.Success(res.data)
            else RepoResult.Error(res.error?.message ?: "Could not load notification history.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    suspend fun retryNotification(email: String, id: String): RepoResult<Unit> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val res = api.retryNotification(RetryNotificationRequest(idToken = token, email = email, id = id))
            if (res.ok) RepoResult.Success(Unit) else RepoResult.Error(res.error ?: "Retry failed.")
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    /**
     * Full account deletion: removes every row tied to this email from the
     * backend FIRST (Code.gs deleteAccount_ — Results, Answers, WrongAnswers,
     * Rankings, RevisionHistory, SubmittedSessions, Reminders, Notifications,
     * UserStats, Users), then deletes the Firebase Auth account itself so
     * the person can no longer sign back in as this identity at all. Order
     * matters: if the backend call fails, we deliberately do NOT delete the
     * Firebase account, so the user can retry rather than being left signed
     * out with orphaned server data still bearing their name and email.
     *
     * Firebase requires a RECENT sign-in to delete an account. If that's
     * the failure, this returns RepoResult.Error("REAUTH_REQUIRED") — the
     * caller (ProfileViewModel) must re-run the sign-in flow (password
     * re-entry or the Google credential prompt again) and call this again,
     * per the Master Prompt's reauthentication requirement.
     */
    suspend fun deleteAccount(email: String): RepoResult<Unit> {
        val token = authRepository.getIdToken() ?: return RepoResult.Error("Not signed in.")
        return try {
            val backendResult = api.deleteAccount(DeleteAccountRequest(idToken = token, email = email))
            if (!backendResult.ok) {
                return RepoResult.Error(backendResult.error ?: "Could not delete your account data. Please try again.")
            }
            when (val firebaseResult = authRepository.deleteFirebaseAccount()) {
                is AuthResult.Success -> RepoResult.Success(Unit)
                is AuthResult.Error -> {
                    if (firebaseResult.message.contains("sign in again", ignoreCase = true)) {
                        RepoResult.Error("REAUTH_REQUIRED")
                    } else {
                        // Backend data is already gone at this point — tell the
                        // user plainly rather than silently leaving it half-done.
                        RepoResult.Error(
                            "Your account data was deleted, but removing your sign-in could not be completed (${firebaseResult.message}). Please contact support if you can still sign in.",
                        )
                    }
                }
            }
        } catch (e: Exception) {
            RepoResult.Error(e.message ?: "No internet connection.")
        }
    }

    /** Called by OutboxSyncWorker on a connectivity-regained trigger. */
    suspend fun flushOutbox() {
        val pending = outboxDao.getAll()
        for (entry in pending) {
            val request = gson.fromJson(entry.payloadJson, SubmitExamRequest::class.java)
            // Refresh the ID token for each queued item — it may have been
            // queued long enough ago that the original token has expired.
            val freshToken = authRepository.getIdToken(forceRefresh = true)
            if (freshToken == null) continue // still signed out — leave queued, try again next trigger
            try {
                val res = api.submitExam(request.copy(idToken = freshToken))
                if (res.ok || res.cooldown?.locked == true) {
                    // Success, OR the server correctly rejected it as a
                    // duplicate/cooldown-locked attempt — either way this
                    // can never succeed by retrying further, so remove it
                    // from the queue rather than retrying forever (same
                    // rule the website's flushOutbox_ applies).
                    outboxDao.delete(entry)
                } else {
                    outboxDao.incrementAttempt(entry.localId)
                }
            } catch (e: Exception) {
                outboxDao.incrementAttempt(entry.localId)
                // Leave it queued; next connectivity-regained trigger retries.
            }
        }
    }
}
