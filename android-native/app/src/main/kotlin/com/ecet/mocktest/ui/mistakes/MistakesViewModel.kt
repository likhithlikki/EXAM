package com.ecet.mocktest.ui.mistakes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.remote.MistakeDto
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

data class MistakesUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val mistakes: List<MistakeDto> = emptyList(),
)

class MistakesViewModel(private val examRepository: ExamRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(MistakesUiState())
    val uiState: StateFlow<MistakesUiState> = _uiState.asStateFlow()

    fun load(email: String) {
        _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            when (val result = examRepository.loadMistakes(email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, mistakes = result.value)
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    /** Mistakes whose revisionDueIso has already passed — the same filter the website's startRevisionTest() applies. */
    fun dueNow(): List<MistakeDto> {
        val now = Instant.now()
        return _uiState.value.mistakes.filter { m ->
            !m.revised && m.revisionDueIso?.let { runCatching { Instant.parse(it) }.getOrNull()?.isBefore(now) } == true
        }
    }
}
