package com.ecet.mocktest.ui.reminders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.remote.NotificationDto
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class NotificationsUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val notifications: List<NotificationDto> = emptyList(),
    val retryingId: String? = null,
)

class NotificationsViewModel(private val examRepository: ExamRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(NotificationsUiState())
    val uiState: StateFlow<NotificationsUiState> = _uiState.asStateFlow()

    private lateinit var email: String

    fun load(email: String) {
        this.email = email
        _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            when (val result = examRepository.loadNotifications(email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, notifications = result.value)
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    fun retry(id: String) {
        _uiState.value = _uiState.value.copy(retryingId = id)
        viewModelScope.launch {
            examRepository.retryNotification(email, id)
            _uiState.value = _uiState.value.copy(retryingId = null)
            load(email)
        }
    }
}
