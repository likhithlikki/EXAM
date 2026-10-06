package com.ecet.mocktest.data.remote

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Talks to the SAME Google Apps Script Web App the website already uses
 * (one deployment, two clients). Every method here corresponds 1:1 to an
 * existing `case '...':` branch in Code.gs's doGet/doPost.
 *
 * IMPLEMENTED in this phase (full vertical slice: login -> home -> exam ->
 * submit -> result, account management, mistakes/revision, reminders,
 * attempt history): homeBundle, subjectStatus, questions, register,
 * submitExam, dashboard, profile, deleteAccount, mistakes, submitRevision,
 * reminders, createReminder, updateReminder, toggleReminder,
 * deleteReminder, notifications, retryNotification, history.
 *
 * NOT YET WIRED natively (still only reachable from the website) — adding
 * each of these is a mechanical repeat of the pattern below, not a new
 * design problem: every admin/control-centre action (importQuestions,
 * updateQuestion, createSubject, adminCooldownList/Adjust, controlLogin/
 * controlData and its subject-management siblings). See
 * IMPLEMENTATION_REPORT.md "Native UI" for the prioritized list.
 *
 * Every call is a plain HTTPS GET/POST to one Apps Script URL — Retrofit's
 * base URL is set to that single endpoint (see NetworkModule), so each
 * @GET/@POST path here is intentionally blank.
 */
interface ApiService {

    @GET(".")
    suspend fun homeBundle(
        @Query("action") action: String = "homeBundle",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<HomeBundleDto>

    @GET(".")
    suspend fun subjectStatus(
        @Query("action") action: String = "subjectStatus",
        @Query("email") email: String,
        @Query("subject") subject: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<SubjectStatusDto>

    @GET(".")
    suspend fun questions(
        @Query("action") action: String = "questions",
        @Query("subjectId") subjectId: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<List<QuestionDto>>

    @GET(".")
    suspend fun dashboard(
        @Query("action") action: String = "dashboard",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<DashboardDto>

    @GET(".")
    suspend fun profile(
        @Query("action") action: String = "profile",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<ProfileDto>

    @POST(".")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @POST(".")
    suspend fun submitExam(@Body request: SubmitExamRequest): SubmitExamResponse

    @POST(".")
    suspend fun deleteAccount(@Body request: DeleteAccountRequest): DeleteAccountResponse

    @GET(".")
    suspend fun mistakes(
        @Query("action") action: String = "mistakes",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<List<MistakeDto>>

    @POST(".")
    suspend fun submitRevision(@Body request: SubmitRevisionRequest): SubmitRevisionResponse

    @GET(".")
    suspend fun history(
        @Query("action") action: String = "history",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<List<AttemptHistoryDto>>

    @GET(".")
    suspend fun reminders(
        @Query("action") action: String = "reminders",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<List<ReminderDto>>

    @POST(".")
    suspend fun createReminder(@Body request: CreateReminderRequest): ReminderMutationResponse

    @POST(".")
    suspend fun updateReminder(@Body request: UpdateReminderRequest): ReminderMutationResponse

    @POST(".")
    suspend fun toggleReminder(@Body request: ToggleReminderRequest): ReminderMutationResponse

    @POST(".")
    suspend fun deleteReminder(@Body request: DeleteReminderRequest): ReminderMutationResponse

    @GET(".")
    suspend fun notifications(
        @Query("action") action: String = "notifications",
        @Query("email") email: String,
        @Query("idToken") idToken: String,
    ): ApiEnvelope<List<NotificationDto>>

    @POST(".")
    suspend fun retryNotification(@Body request: RetryNotificationRequest): RetryNotificationResponse
}
