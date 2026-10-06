package com.ecet.mocktest.ui.auth

import com.ecet.mocktest.data.local.SessionManager
import com.ecet.mocktest.data.remote.ApiService
import com.ecet.mocktest.data.repository.AuthRepository
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * Covers the synchronous validation gates that run BEFORE any Firebase or
 * network call is made (so no coroutine dispatcher setup is needed). These
 * protect the two rules that matter legally/security-wise: consent must be
 * ticked before any sign-in/sign-up attempt, and empty credentials never
 * reach Firebase.
 */
class LoginViewModelTest {

    private lateinit var viewModel: LoginViewModel

    @Before
    fun setUp() {
        viewModel = LoginViewModel(
            authRepository = mockk<AuthRepository>(relaxed = true),
            api = mockk<ApiService>(relaxed = true),
            sessionManager = mockk<SessionManager>(relaxed = true),
        )
    }

    @Test
    fun `blank email or password shows an error and does not start loading`() {
        viewModel.submitEmailPassword()
        val state = viewModel.uiState.value
        assertNotNull(state.errorMessage)
        assertFalse(state.isLoading)
    }

    @Test
    fun `sign in without consent is blocked with the consent message`() {
        viewModel.onEmailChange("student@example.com")
        viewModel.onPasswordChange("secret123")
        viewModel.submitEmailPassword()
        val state = viewModel.uiState.value
        assertEquals("Please agree to the Privacy Policy and Terms to continue.", state.errorMessage)
        assertFalse(state.isLoading)
        assertFalse(state.signedIn)
    }

    @Test
    fun `create account requires a name`() {
        viewModel.onModeToggle()
        viewModel.onEmailChange("student@example.com")
        viewModel.onPasswordChange("secret123")
        viewModel.onConsentToggle(true)
        viewModel.submitEmailPassword()
        assertEquals("Enter your name.", viewModel.uiState.value.errorMessage)
    }

    @Test
    fun `mode toggle clears messages`() {
        viewModel.submitEmailPassword()
        viewModel.onModeToggle()
        assertEquals(null, viewModel.uiState.value.errorMessage)
        assertEquals(AuthMode.CREATE_ACCOUNT, viewModel.uiState.value.mode)
    }
}
