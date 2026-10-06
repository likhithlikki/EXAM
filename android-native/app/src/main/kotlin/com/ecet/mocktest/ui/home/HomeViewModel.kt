package com.ecet.mocktest.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.HomeBundleDto
import com.ecet.mocktest.data.repository.AuthRepository
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val bundle: HomeBundleDto? = null,
    val session: UserSession? = null,
    val outboxPendingCount: Int = 0,
)

class HomeViewModel(
    private val examRepository: ExamRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            examRepository.outboxCountFlow().collect { count ->
                _uiState.value = _uiState.value.copy(outboxPendingCount = count)
            }
        }
    }

    fun load(session: UserSession) {
        _uiState.value = _uiState.value.copy(isLoading = true, session = session, errorMessage = null)
        viewModelScope.launch {
            when (val result = examRepository.loadHomeBundle(session.email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, bundle = result.value)
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    // Sign-out now lives on the Profile screen (ProfileViewModel), matching
    // the website's pattern of Logout being a Profile-page action rather
    // than a Home-page one. authRepository is kept as a constructor param
    // here in case Home needs auth-state checks later (e.g. re-verifying
    // session validity on resume).
}
