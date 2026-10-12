package com.ecet.mocktest.ui.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.local.SessionManager
import com.ecet.mocktest.data.remote.ApiService
import com.ecet.mocktest.data.remote.RegisterRequest
import com.ecet.mocktest.data.repository.AuthRepository
import com.ecet.mocktest.data.repository.AuthResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class AuthMode { SIGN_IN, CREATE_ACCOUNT }

data class LoginUiState(
    val mode: AuthMode = AuthMode.SIGN_IN,
    val name: String = "",
    val email: String = "",
    val password: String = "",
    val consentChecked: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val signedIn: Boolean = false,
)

/**
 * Consent is collected here — once, right after the FIRST successful
 * sign-in/sign-up — and sent to the backend as part of the same register()
 * call that used to just be "save my name and email" on the website. This
 * is the native equivalent of the website's consentFieldsHTML_ /
 * readConsentOrShowError_ gate: the checkbox is mandatory before the
 * account is usable, and consent is recorded server-side with a timestamp
 * (see Code.gs register_() — same ConsentGiven/ConsentAt columns the
 * website's consent work already added, now also written when the native
 * app registers).
 */
class LoginViewModel(
    private val authRepository: AuthRepository,
    private val api: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onModeToggle() {
        _uiState.value = _uiState.value.copy(
            mode = if (_uiState.value.mode == AuthMode.SIGN_IN) AuthMode.CREATE_ACCOUNT else AuthMode.SIGN_IN,
            errorMessage = null,
            infoMessage = null,
        )
    }

    fun onNameChange(v: String) { _uiState.value = _uiState.value.copy(name = v) }
    fun onEmailChange(v: String) { _uiState.value = _uiState.value.copy(email = v) }
    fun onPasswordChange(v: String) { _uiState.value = _uiState.value.copy(password = v) }
    fun onConsentToggle(v: Boolean) { _uiState.value = _uiState.value.copy(consentChecked = v) }

    fun signInWithGoogle(activityContext: Context) {
        if (!requireConsentOrShowError()) return
        setLoading(true)
        viewModelScope.launch {
            when (val result = authRepository.signInWithGoogle(activityContext)) {
                is AuthResult.Success -> completeSignIn(result.user?.displayName ?: result.user?.email.orEmpty())
                is AuthResult.Error -> fail(result.message)
            }
        }
    }

    fun submitEmailPassword() {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.isBlank()) {
            fail("Enter your email and password.")
            return
        }
        if (state.mode == AuthMode.CREATE_ACCOUNT && state.name.isBlank()) {
            fail("Enter your name.")
            return
        }
        if (!requireConsentOrShowError()) return

        setLoading(true)
        viewModelScope.launch {
            val result = if (state.mode == AuthMode.SIGN_IN) {
                authRepository.signInWithEmail(state.email, state.password)
            } else {
                authRepository.createAccountWithEmail(state.email, state.password)
            }
            when (result) {
                is AuthResult.Success -> completeSignIn(state.name.ifBlank { state.email.substringBefore("@") })
                is AuthResult.Error -> fail(result.message)
            }
        }
    }

    fun sendPasswordReset() {
        val email = _uiState.value.email
        if (email.isBlank()) {
            fail("Enter your email first, then tap 'Forgot password?' again.")
            return
        }
        setLoading(true)
        viewModelScope.launch {
            when (val result = authRepository.sendPasswordReset(email)) {
                is AuthResult.Success -> {
                    setLoading(false)
                    _uiState.value = _uiState.value.copy(infoMessage = "Password reset email sent to $email.")
                }
                is AuthResult.Error -> fail(result.message)
            }
        }
    }

    private fun requireConsentOrShowError(): Boolean {
        if (!_uiState.value.consentChecked) {
            fail("Please agree to the Privacy Policy and Terms to continue.")
            return false
        }
        return true
    }

    private suspend fun completeSignIn(displayName: String) {
        val user = authRepository.currentUser
        val token = authRepository.getIdToken()
        if (user == null || token == null) {
            fail("Sign-in succeeded but no session token was available. Please try again.")
            return
        }
        val response = runCatching {
            api.register(
                RegisterRequest(
                    idToken = token,
                    name = displayName.ifBlank { "Student" },
                    email = user.email.orEmpty(),
                    consent = true,
                ),
            )
        }.getOrNull()

        val isAdmin = false // resolved by the backend's admin allowlist on first homeBundle call, not assumed here
        sessionManager.save(authRepository.toUserSession(user, isAdmin = isAdmin, consentGiven = true))

        setLoading(false)
        _uiState.value = _uiState.value.copy(signedIn = true, errorMessage = null)

        if (response?.ok == false) {
            // Non-fatal: the Firebase session is real either way; the
            // profile-sync call can be retried by HomeViewModel's next
            // homeBundle load, so we don't block entry to the app over it.
        }
    }

    private fun setLoading(loading: Boolean) {
        _uiState.value = _uiState.value.copy(isLoading = loading, errorMessage = null, infoMessage = null)
    }

    private fun fail(message: String) {
        _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = message)
    }
}
