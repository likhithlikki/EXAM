package com.ecet.mocktest.data.remote

import com.google.gson.annotations.SerializedName

// ---- Generic envelope Code.gs's doGet(e) uses for every action: out_({ok, data}) or out_({ok, error}) ----
data class ApiEnvelope<T>(
    val ok: Boolean,
    val data: T? = null,
    val error: ApiError? = null,
)

/**
 * Code.gs's existing out_({ok:false, error: 'a string'}) shape and the
 * Master Prompt's requested structured {code, message} shape can BOTH show
 * up here during the migration window — see requireAuthenticatedUser_ in
 * the updated Code.gs, which emits the structured form only for the new
 * auth-gated failures, while every pre-existing error stays a plain
 * string so the website (which expects a string) never breaks. Gson maps
 * a bare JSON string onto `message` via the custom deserializer registered
 * in NetworkModule.
 */
data class ApiError(
    val code: String = "SERVER_ERROR",
    val message: String = "Something went wrong.",
)

// ---- homeBundle ----
data class HomeBundleDto(
    val online: Boolean = true,
    val isAdmin: Boolean = false,
    val customSubjects: List<SubjectDto> = emptyList(),
    val dashboard: DashboardDto? = null,
)

data class SubjectDto(
    val id: String,
    val name: String,
    val password: String? = null, // legacy web-only field; native auth flow ignores this, see IMPLEMENTATION_REPORT.md
    val description: String? = null,
    val questionCount: Int = 0,
)

data class DashboardDto(
    val attempts: Int = 0,
    val best: Double = 0.0,
    val avg: Double = 0.0,
    val mistakes: Int = 0,
    val subjects: List<SubjectStatDto> = emptyList(),
)

data class SubjectStatDto(
    val subject: String,
    val best: Double = 0.0,
    val worst: Double = 0.0,
    val avg: Double = 0.0,
    val attempts: Int = 0,
    val lastAttempt: String? = null,
)

// ---- subjectStatus (cooldown check) ----
data class SubjectStatusDto(
    val locked: Boolean,
    val lastAttempt: String? = null,
    val unlockAt: String? = null,
)

// ---- questions ----
data class QuestionDto(
    val id: String,
    val year: String = "",
    val state: String = "",
    val questionNumber: String = "",
    val question: String,
    val options: List<String>,
    val answer: Int,
    val image: String = "",
    val optionImages: List<String> = emptyList(),
)

// ---- register (now UID + consent aware; see Code.gs register_ changes) ----
data class RegisterRequest(
    val action: String = "register",
    val idToken: String,
    val name: String,
    val email: String,
    val consent: Boolean,
    val subject: String? = null,
)

data class RegisterResponse(
    val ok: Boolean,
    val existing: Boolean = false,
    val message: String = "",
)

// ---- submitExam ----
data class QuestionAnswerDto(
    val id: String,
    val year: String,
    val state: String,
    val questionNumber: String,
    val correct: Int,
    val selected: Int?,
    val marked: Boolean,
    val time: Int,
    val question: String? = null,
    val options: List<String>? = null,
    val image: String? = null,
    val optionImages: List<String>? = null,
)

data class SubmitExamRequest(
    val action: String = "submitExam",
    val idToken: String,
    val examSessionId: String,
    val name: String,
    val email: String,
    val subject: String,
    val subjectId: String,
    val detail: List<QuestionAnswerDto>,
    val startTime: String,
    val testUrl: String = "",
)

data class SubmitExamResponse(
    val ok: Boolean,
    val resultId: String? = null,
    val rank: Int? = null,
    val rankOutOf: Int? = null,
    val expectedRank: String? = null,
    val revisionAvailableAt: String? = null,
    val emailStatus: String? = null,
    val duplicate: Boolean = false,
    val cooldown: CooldownDto? = null,
    val error: String? = null,
)

data class CooldownDto(
    val locked: Boolean = false,
    val unlockAt: String? = null,
)

// ---- dashboard (dedicated, fresher pull than homeBundle's cached copy) ----
// Reuses DashboardDto/SubjectStatDto already defined above for homeBundle —
// same shape, same Code.gs dashboard_() function underneath either way.

// ---- profile ----
data class ProfileDto(
    val name: String = "",
    val email: String = "",
    val createdAt: String? = null,
    val attempts: Int = 0,
    val avg: Double = 0.0,
    val best: Double = 0.0,
    val mistakes: Int = 0,
    val reminders: Int = 0,
    val subjects: List<SubjectStatDto> = emptyList(),
)

// ---- mistakes / revision ----
data class MistakeDto(
    val wrongId: String,
    val resultId: String? = null,
    val subject: String = "",
    val questionId: String = "",
    val year: String = "",
    val state: String = "",
    val questionNumber: String = "",
    val question: String = "",
    val options: List<String> = emptyList(),
    val image: String = "",
    val optionImages: List<String> = emptyList(),
    val correctIndex: Int = 0,
    val selectedIndex: Int? = null,
    val mistakeType: String = "wrong",
    val revisionDueIso: String? = null,
    val revised: Boolean = false,
    val testUrl: String = "",
)

data class RevisionItemAnswer(
    val wrongId: String,
    val selected: Int?,
    val time: Int,
)

data class SubmitRevisionRequest(
    val action: String = "submitRevision",
    val idToken: String,
    val email: String,
    val items: List<RevisionItemAnswer>,
)

data class SubmitRevisionResponse(
    val ok: Boolean,
    val correct: Int = 0,
    val wrong: Int = 0,
    val unattempted: Int = 0,
    val total: Int = 0,
    val error: String? = null,
)

// ---- attempt history ----
data class AttemptHistoryDto(
    val resultId: String,
    val timestamp: String,
    val subject: String,
    val subjectId: String? = null,
    val score: Int = 0,
    val total: Int = 0,
    val percentage: Double = 0.0,
    val correct: Int = 0,
    val wrong: Int = 0,
    val unanswered: Int = 0,
    val totalTimeSec: Int = 0,
    val rank: Int? = null,
    val rankOutOf: Int? = null,
    val startTime: String? = null,
    val endTime: String? = null,
)

// ---- reminders ----
data class ReminderDto(
    val id: String,
    val userName: String = "",
    val name: String = "",
    val message: String = "",
    val relatedTask: String = "",
    val relatedUrl: String = "",
    val frequency: String = "once",
    val nextRunAt: String? = null,
    val status: String = "Active",
    val enabled: Boolean = true,
    val lastSentAt: String? = null,
)

data class CreateReminderRequest(
    val action: String = "createReminder",
    val idToken: String,
    val email: String,
    val userName: String,
    val name: String,
    val message: String,
    val relatedTask: String = "",
    val relatedUrl: String = "",
    val frequency: String,
    val nextRunAt: String, // ISO instant
)

data class UpdateReminderRequest(
    val action: String = "updateReminder",
    val idToken: String,
    val email: String,
    val id: String,
    val userName: String,
    val name: String,
    val message: String,
    val relatedTask: String = "",
    val relatedUrl: String = "",
    val frequency: String,
    val nextRunAt: String,
)

data class ToggleReminderRequest(
    val action: String = "toggleReminder",
    val idToken: String,
    val email: String,
    val id: String,
    val enabled: Boolean,
)

data class DeleteReminderRequest(
    val action: String = "deleteReminder",
    val idToken: String,
    val email: String,
    val id: String,
)

data class ReminderMutationResponse(
    val ok: Boolean,
    val id: String? = null,
    val nextRunAt: String? = null,
    val status: String? = null,
    val enabled: Boolean? = null,
    val duplicate: Boolean = false,
    val error: String? = null,
)

// ---- notifications ----
data class NotificationDto(
    val id: String,
    val reminderId: String? = null,
    val name: String = "",
    val message: String = "",
    val relatedTask: String = "",
    val relatedUrl: String = "",
    val scheduledAt: String? = null,
    val sentAt: String? = null,
    val status: String = "",
    val error: String = "",
    val retryCount: Int = 0,
)

data class RetryNotificationRequest(
    val action: String = "retryNotification",
    val idToken: String,
    val email: String,
    val id: String,
)

data class RetryNotificationResponse(
    val ok: Boolean,
    val sent: Boolean = false,
    val retryNotificationId: String? = null,
    val error: String? = null,
)

// ---- deleteAccount ----
data class DeleteAccountRequest(
    val action: String = "deleteAccount",
    val idToken: String,
    val email: String,
)

data class DeleteAccountResponse(
    val ok: Boolean,
    val message: String? = null,
    val error: String? = null,
)
