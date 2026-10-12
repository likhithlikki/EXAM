package com.ecet.mocktest.ui.exam

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.QuestionAnswerDto
import com.ecet.mocktest.data.remote.QuestionDto
import com.ecet.mocktest.data.remote.SubmitExamRequest
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import com.ecet.mocktest.util.ConnectivityObserver
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

enum class ExamPhase { LOADING, LOCKED, ERROR, IN_PROGRESS, SUBMITTING, RESULT }

data class ExamUiState(
    val phase: ExamPhase = ExamPhase.LOADING,
    val errorMessage: String? = null,
    val lockedUntil: String? = null,
    val questions: List<QuestionDto> = emptyList(),
    val currentIndex: Int = 0,
    val answers: Map<Int, Int> = emptyMap(), // questionIndex -> selectedOptionIndex
    val marked: Set<Int> = emptySet(),
    val secondsLeft: Int = 0,
    val result: ExamResultUi? = null,
)

data class ExamResultUi(
    val score: Int,
    val total: Int,
    val percentage: Double,
    val rank: Int?,
    val rankOutOf: Int?,
    val expectedRank: String?,
    val offlinePending: Boolean,
)

/**
 * STRICT single-source-of-truth submit guard, ported from the website's
 * `examActive` fix (see this project's history: the web app used to derive
 * "is an exam running" from several stale variables at once, which let a
 * finished exam get re-submitted after navigating away and back). Here,
 * `examActive` is flipped to false in exactly one place — the instant
 * submit() begins — and nothing later in this ViewModel's lifecycle can
 * turn it back on for the same attempt.
 */
class ExamViewModel(
    private val examRepository: ExamRepository,
    private val connectivityObserver: ConnectivityObserver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ExamUiState())
    val uiState: StateFlow<ExamUiState> = _uiState.asStateFlow()

    private var examActive = false
    private var timerJob: Job? = null
    private val examSessionId = UUID.randomUUID().toString()
    private var examStartInstant: Instant = Instant.now()
    private lateinit var subjectId: String
    private lateinit var subjectName: String
    private lateinit var session: UserSession
    private val questionTimeSpentSec = mutableMapOf<Int, Int>()

    fun start(session: UserSession, subjectId: String, subjectName: String) {
        this.session = session
        this.subjectId = subjectId
        this.subjectName = subjectName
        _uiState.value = ExamUiState(phase = ExamPhase.LOADING)

        viewModelScope.launch {
            // 1. Live cooldown check FIRST — never trust a locally cached
            // "is it locked" value for this decision (see ExamRepository
            // doc comment / this project's "Retry Test bypassing the lock"
            // history for why that specific shortcut is unsafe).
            when (val lockCheck = examRepository.checkSubjectLock(session.email, subjectName)) {
                is RepoResult.Success -> {
                    if (lockCheck.value.locked) {
                        _uiState.value = _uiState.value.copy(phase = ExamPhase.LOCKED, lockedUntil = lockCheck.value.unlockAt)
                        return@launch
                    }
                }
                is RepoResult.Error -> { /* fail-open on the pre-check; server still enforces it at submit time */ }
            }

            val isOnline = connectivityObserver.isCurrentlyOnline()
            when (val result = examRepository.loadQuestions(subjectId, isOnline)) {
                is RepoResult.Success -> {
                    val shuffled = result.value.shuffled()
                    examStartInstant = Instant.now()
                    examActive = true
                    _uiState.value = _uiState.value.copy(
                        phase = ExamPhase.IN_PROGRESS,
                        questions = shuffled,
                        secondsLeft = shuffled.size * 60, // 1 minute per question, same rule as the website
                    )
                    startTimer()
                }
                is RepoResult.Error -> {
                    _uiState.value = _uiState.value.copy(phase = ExamPhase.ERROR, errorMessage = result.message)
                }
            }
        }
    }

    private fun startTimer() {
        timerJob?.cancel()
        timerJob = viewModelScope.launch {
            while (_uiState.value.secondsLeft > 0 && examActive) {
                delay(1000)
                if (!examActive) return@launch
                val remaining = _uiState.value.secondsLeft - 1
                _uiState.value = _uiState.value.copy(secondsLeft = remaining)
                questionTimeSpentSec[_uiState.value.currentIndex] =
                    (questionTimeSpentSec[_uiState.value.currentIndex] ?: 0) + 1
                if (remaining <= 0) {
                    submit()
                }
            }
        }
    }

    fun selectAnswer(optionIndex: Int) {
        if (!examActive) return
        val current = _uiState.value.currentIndex
        _uiState.value = _uiState.value.copy(answers = _uiState.value.answers + (current to optionIndex))
    }

    fun toggleMark() {
        val current = _uiState.value.currentIndex
        val marked = _uiState.value.marked.toMutableSet()
        if (!marked.add(current)) marked.remove(current)
        _uiState.value = _uiState.value.copy(marked = marked)
    }

    fun goTo(index: Int) {
        if (index !in _uiState.value.questions.indices) return
        _uiState.value = _uiState.value.copy(currentIndex = index)
    }

    /**
     * The ONE place examActive is ever set back to false. Everything after
     * this line — including navigating away, back, or the phase changing to
     * RESULT — can no longer re-trigger a second submission of this attempt.
     */
    fun submit() {
        if (!examActive) return
        examActive = false
        timerJob?.cancel()
        _uiState.value = _uiState.value.copy(phase = ExamPhase.SUBMITTING)

        viewModelScope.launch {
            val state = _uiState.value
            val detail = state.questions.mapIndexed { index, q ->
                QuestionAnswerDto(
                    id = q.id,
                    year = q.year,
                    state = q.state,
                    questionNumber = q.questionNumber,
                    correct = q.answer,
                    selected = state.answers[index],
                    marked = state.marked.contains(index),
                    time = questionTimeSpentSec[index] ?: 0,
                )
            }
            val correct = detail.count { it.selected != null && it.selected == it.correct }
            val total = detail.size
            val percentage = if (total > 0) (correct.toDouble() / total * 100) else 0.0

            val request = SubmitExamRequest(
                idToken = "", // filled in by ExamRepository/OutboxSyncWorker right before each real send, so a queued item always uses a FRESH token, never a stale one captured at submit time
                examSessionId = examSessionId,
                name = session.name,
                email = session.email,
                subject = subjectName,
                subjectId = subjectId,
                detail = detail,
                startTime = examStartInstant.toString(),
            )

            val isOnline = connectivityObserver.isCurrentlyOnline()
            when (val result = examRepository.submitExam(request, isOnline)) {
                is RepoResult.Success -> {
                    val resp = result.value
                    if (resp.cooldown?.locked == true) {
                        _uiState.value = _uiState.value.copy(phase = ExamPhase.LOCKED, lockedUntil = resp.cooldown.unlockAt)
                    } else {
                        _uiState.value = _uiState.value.copy(
                            phase = ExamPhase.RESULT,
                            result = ExamResultUi(
                                score = correct,
                                total = total,
                                percentage = percentage,
                                rank = resp.rank,
                                rankOutOf = resp.rankOutOf,
                                expectedRank = resp.expectedRank,
                                offlinePending = false,
                            ),
                        )
                    }
                }
                is RepoResult.Error -> {
                    // "OFFLINE_QUEUED" is not a failure the user needs to
                    // retry — ExamRepository already wrote it to the Room
                    // outbox; show the locally-computed result immediately,
                    // same as the website does when offline.
                    _uiState.value = _uiState.value.copy(
                        phase = ExamPhase.RESULT,
                        result = ExamResultUi(
                            score = correct,
                            total = total,
                            percentage = percentage,
                            rank = null,
                            rankOutOf = null,
                            expectedRank = null,
                            offlinePending = true,
                        ),
                    )
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
    }
}
