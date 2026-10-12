package com.ecet.mocktest.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.remote.AttemptHistoryDto
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AttemptHistoryUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val attempts: List<AttemptHistoryDto> = emptyList(),
    val compareIds: List<String> = emptyList(), // at most 2, oldest-selected-first-out when a 3rd is picked
)

class AttemptHistoryViewModel(private val examRepository: ExamRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(AttemptHistoryUiState())
    val uiState: StateFlow<AttemptHistoryUiState> = _uiState.asStateFlow()

    fun load(email: String) {
        _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            when (val result = examRepository.loadHistory(email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, attempts = result.value)
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    /** Mirrors the website's toggleCompare(): selecting a 3rd item bumps the oldest selection out. */
    fun toggleCompare(resultId: String) {
        val current = _uiState.value.compareIds
        val updated = if (current.contains(resultId)) {
            current - resultId
        } else {
            (if (current.size >= 2) current.drop(1) else current) + resultId
        }
        _uiState.value = _uiState.value.copy(compareIds = updated)
    }

    fun compareAttempts(): Pair<AttemptHistoryDto, AttemptHistoryDto>? {
        val ids = _uiState.value.compareIds
        if (ids.size != 2) return null
        val byId = _uiState.value.attempts.associateBy { it.resultId }
        val a = byId[ids[0]] ?: return null
        val b = byId[ids[1]] ?: return null
        // Oldest first, same as the website's compareHTML() sort.
        return if ((a.endTime ?: a.timestamp) <= (b.endTime ?: b.timestamp)) a to b else b to a
    }
}
