package com.ecet.mocktest.ui.mistakes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.remote.MistakeDto
import com.ecet.mocktest.data.remote.RevisionItemAnswer
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class RevisionPhase { IN_PROGRESS, SUBMITTING, RESULT, ERROR }

data class RevisionQuestionUi(
    val wrongId: String,
    val question: String,
    val options: List<String>,
    val image: String,
    val optionImages: List<String>,
)

data class RevisionResultUi(val correct: Int, val wrong: Int, val unattempted: Int, val total: Int)

data class RevisionUiState(
    val phase: RevisionPhase = RevisionPhase.IN_PROGRESS,
    val errorMessage: String? = null,
    val questions: List<RevisionQuestionUi> = emptyList(),
    val currentIndex: Int = 0,
    val answers: Map<Int, Int> = emptyMap(),
    val secondsLeft: Int = 0,
    val result: RevisionResultUi? = null,
)

/**
 * Mirrors the website's startRevisionTest()/submitRevisionTest(): items are
 * ALREADY known (passed in from MistakesViewModel.dueNow(), no separate
 * network call to start), options are shuffled per item the same way, the
 * same 1-minute-per-question timer applies, and submitting is a single-fire
 * guard (same `active` pattern as ExamViewModel's examActive — see that
 * file's doc comment for why this matters).
 */
class RevisionViewModel(private val examRepository: ExamRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(RevisionUiState())
    val uiState: StateFlow<RevisionUiState> = _uiState.asStateFlow()

    private var active = false
    private var timerJob: Job? = null
    private lateinit var email: String
    private val questionTimeSpentSec = mutableMapOf<Int, Int>()

    fun start(email: String, items: List<MistakeDto>) {
        this.email = email
        val shuffled = items.map { item ->
            val order = item.options.indices.shuffled()
            RevisionQuestionUi(
                wrongId = item.wrongId,
                question = item.question,
                options = order.map { item.options[it] },
                image = item.image,
                optionImages = order.map { item.optionImages.getOrElse(it) { "" } },
            )
        }
        active = true
        _uiState.value = RevisionUiState(
            phase = RevisionPhase.IN_PROGRESS,
            questions = shuffled,
            secondsLeft = shuffled.size * 60,
        )
        startTimer()
    }

    private fun startTimer() {
        timerJob?.cancel()
        timerJob = viewModelScope.launch {
            while (_uiState.value.secondsLeft > 0 && active) {
                delay(1000)
                if (!active) return@launch
                val remaining = _uiState.value.secondsLeft - 1
                _uiState.value = _uiState.value.copy(secondsLeft = remaining)
                questionTimeSpentSec[_uiState.value.currentIndex] = (questionTimeSpentSec[_uiState.value.currentIndex] ?: 0) + 1
                if (remaining <= 0) submit()
            }
        }
    }

    fun selectAnswer(optionIndex: Int) {
        if (!active) return
        val current = _uiState.value.currentIndex
        _uiState.value = _uiState.value.copy(answers = _uiState.value.answers + (current to optionIndex))
    }

    fun goTo(index: Int) {
        if (index !in _uiState.value.questions.indices) return
        _uiState.value = _uiState.value.copy(currentIndex = index)
    }

    fun submit() {
        if (!active) return
        active = false
        timerJob?.cancel()
        _uiState.value = _uiState.value.copy(phase = RevisionPhase.SUBMITTING)

        viewModelScope.launch {
            val state = _uiState.value
            val items = state.questions.mapIndexed { index, q ->
                RevisionItemAnswer(wrongId = q.wrongId, selected = state.answers[index], time = questionTimeSpentSec[index] ?: 0)
            }
            when (val result = examRepository.submitRevision(email, items)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(
                    phase = RevisionPhase.RESULT,
                    result = RevisionResultUi(
                        correct = result.value.correct,
                        wrong = result.value.wrong,
                        unattempted = result.value.unattempted,
                        total = result.value.total,
                    ),
                )
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(phase = RevisionPhase.ERROR, errorMessage = result.message)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
    }
}
