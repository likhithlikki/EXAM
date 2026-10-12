package com.ecet.mocktest.ui.profile

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.ApiService
import com.ecet.mocktest.data.remote.ProfileDto
import com.ecet.mocktest.data.remote.RegisterRequest
import com.ecet.mocktest.data.repository.AuthRepository
import com.ecet.mocktest.data.repository.AuthResult
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import com.google.firebase.auth.EmailAuthProvider
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class DeleteStep { NONE, CONFIRM, REAUTH_PASSWORD, DELETING, DONE }

data class ProfileUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val profile: ProfileDto? = null,
    val editingName: String = "",
    val isSavingName: Boolean = false,
    val saveError: String? = null,
    val deleteStep: DeleteStep = DeleteStep.NONE,
    val deleteError: String? = null,
    val isGoogleProvider: Boolean = false,
)

/**
 * Play Store requires an in-app account-deletion path for any app with
 * accounts (this is that path) — see IMPLEMENTATION_REPORT.md "Delete
 * Account" gap this closes. Deletion mirrors the website's
 * deleteAccountPrompt()/deleteAccount_ flow: backend data first, then the
 * identity itself, with an explicit re-authentication step when Firebase
 * requires a recent sign-in (Google re-picks the account; Email/Password
 * re-enters the password) rather than failing silently.
 */
class ProfileViewModel(
    private val examRepository: ExamRepository,
    private val authRepository: AuthRepository,
    private val api: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    private lateinit var session: UserSession

    fun load(session: UserSession) {
        this.session = session
        val isGoogle = authRepository.currentUser?.providerData
            ?.any { it.providerId == "google.com" } ?: false
        _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null, isGoogleProvider = isGoogle)
        viewModelScope.launch {
            when (val result = examRepository.loadProfile(session.email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    profile = result.value,
                    editingName = result.value.name,
                )
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    fun onNameChange(v: String) { _uiState.value = _uiState.value.copy(editingName = v) }

    fun saveName() {
        val name = _uiState.value.editingName.trim()
        if (name.isBlank()) {
            _uiState.value = _uiState.value.copy(saveError = "Enter a valid name.")
            return
        }
        _uiState.value = _uiState.value.copy(isSavingName = true, saveError = null)
        viewModelScope.launch {
            val token = authRepository.getIdToken()
            if (token == null) {
                _uiState.value = _uiState.value.copy(isSavingName = false, saveError = "Not signed in.")
                return@launch
            }
            val response = runCatching {
                api.register(RegisterRequest(idToken = token, name = name, email = session.email, consent = true))
            }.getOrNull()
            if (response?.ok == true) {
                _uiState.value = _uiState.value.copy(
                    isSavingName = false,
                    profile = _uiState.value.profile?.copy(name = name),
                )
            } else {
                _uiState.value = _uiState.value.copy(isSavingName = false, saveError = "Could not save. Check your connection.")
            }
        }
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            authRepository.signOut()
            onDone()
        }
    }

    // ---- Delete account flow ----

    fun requestDelete() { _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.CONFIRM, deleteError = null) }
    fun cancelDelete() { _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.NONE, deleteError = null) }

    fun confirmDelete() {
        _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.DELETING)
        performDelete()
    }

    fun reauthenticateWithGoogle(activityContext: Context) {
        _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.DELETING, deleteError = null)
        viewModelScope.launch {
            when (val result = authRepository.signInWithGoogle(activityContext)) {
                is AuthResult.Success -> performDelete()
                is AuthResult.Error -> _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.REAUTH_PASSWORD, deleteError = result.message)
            }
        }
    }

    fun reauthenticateWithPassword(password: String) {
        if (password.isBlank()) {
            _uiState.value = _uiState.value.copy(deleteError = "Enter your password.")
            return
        }
        val user = authRepository.currentUser
        val email = user?.email
        if (user == null || email == null) {
            _uiState.value = _uiState.value.copy(deleteError = "Not signed in.")
            return
        }
        _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.DELETING, deleteError = null)
        viewModelScope.launch {
            try {
                val credential = EmailAuthProvider.getCredential(email, password)
                user.reauthenticate(credential).await()
                performDelete()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    deleteStep = DeleteStep.REAUTH_PASSWORD,
                    deleteError = "Incorrect password. Please try again.",
                )
            }
        }
    }

    private fun performDelete() {
        viewModelScope.launch {
            when (val result = examRepository.deleteAccount(session.email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.DONE)
                is RepoResult.Error -> {
                    if (result.message == "REAUTH_REQUIRED") {
                        _uiState.value = _uiState.value.copy(
                            deleteStep = if (_uiState.value.isGoogleProvider) DeleteStep.CONFIRM else DeleteStep.REAUTH_PASSWORD,
                            deleteError = "For your security, please confirm your identity to continue.",
                        )
                    } else {
                        _uiState.value = _uiState.value.copy(deleteStep = DeleteStep.CONFIRM, deleteError = result.message)
                    }
                }
            }
        }
    }
}
