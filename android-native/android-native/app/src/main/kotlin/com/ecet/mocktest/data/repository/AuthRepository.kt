package com.ecet.mocktest.data.repository

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.ecet.mocktest.data.local.SessionManager
import com.ecet.mocktest.data.local.UserSession
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/**
 * Owns all Firebase Authentication flows. This REPLACES the website's old
 * model of "an email typed into a form IS the identity" (see the original
 * app.js store.profile()/localStorage pattern) — the canonical identity
 * here is always `FirebaseAuth.currentUser.uid`, and email is treated as
 * profile data the user happens to also have, never as proof of who they
 * are. Every backend call that needs to know "who is this" sends a fresh
 * Firebase ID token (see RemoteAuthInterceptor / ApiService) instead of an
 * email string the client could type in as anyone.
 *
 * Uses the current (non-deprecated) Credential Manager + Google ID library
 * flow for "Sign in with Google" rather than the old GoogleSignInClient API,
 * per the Master Prompt's explicit requirement.
 */
class AuthRepository(
    private val context: Context,
    private val firebaseAuth: FirebaseAuth,
    private val sessionManager: SessionManager,
    private val webClientId: String,
) {

    val currentUser: FirebaseUser?
        get() = firebaseAuth.currentUser

    /** True if a Firebase session already exists — used by MainActivity to skip Login on relaunch. */
    fun hasSession(): Boolean = firebaseAuth.currentUser != null

    /**
     * `activityContext` MUST be an Activity: Credential Manager shows the
     * Google account chooser as a system bottom sheet anchored to an
     * Activity, and fails with the Application context this class is
     * constructed with. It is used only for the duration of this call and
     * never stored.
     */
    suspend fun signInWithGoogle(activityContext: Context): AuthResult {
        val credentialManager = CredentialManager.create(activityContext)

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId) // Firebase Web Client ID — see IMPLEMENTATION_REPORT.md "Manual setup"
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        return try {
            val response = credentialManager.getCredential(activityContext, request)
            val credential = response.credential
            val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
            val firebaseCredential = GoogleAuthProvider.getCredential(googleIdTokenCredential.idToken, null)
            val authResult = firebaseAuth.signInWithCredential(firebaseCredential).await()
            val user = authResult.user ?: return AuthResult.Error("No user returned by Firebase.")
            AuthResult.Success(user)
        } catch (e: GetCredentialException) {
            AuthResult.Error(e.message ?: "Google sign-in was cancelled or unavailable.")
        } catch (e: Exception) {
            AuthResult.Error(e.message ?: "Google sign-in failed.")
        }
    }

    suspend fun signInWithEmail(email: String, password: String): AuthResult {
        return try {
            val result = firebaseAuth.signInWithEmailAndPassword(email.trim(), password).await()
            val user = result.user ?: return AuthResult.Error("No user returned by Firebase.")
            AuthResult.Success(user)
        } catch (e: Exception) {
            AuthResult.Error(mapFirebaseError(e))
        }
    }

    suspend fun createAccountWithEmail(email: String, password: String): AuthResult {
        return try {
            val result = firebaseAuth.createUserWithEmailAndPassword(email.trim(), password).await()
            val user = result.user ?: return AuthResult.Error("No user returned by Firebase.")
            // Fire-and-forget: don't block the sign-up flow on the verification
            // email send; the user can still use the app and re-request it later.
            runCatching { user.sendEmailVerification().await() }
            AuthResult.Success(user)
        } catch (e: Exception) {
            AuthResult.Error(mapFirebaseError(e))
        }
    }

    suspend fun sendPasswordReset(email: String): AuthResult {
        return try {
            firebaseAuth.sendPasswordResetEmail(email.trim()).await()
            AuthResult.Success(null)
        } catch (e: Exception) {
            AuthResult.Error(mapFirebaseError(e))
        }
    }

    suspend fun resendEmailVerification(): AuthResult {
        val user = firebaseAuth.currentUser ?: return AuthResult.Error("Not signed in.")
        return try {
            user.sendEmailVerification().await()
            AuthResult.Success(user)
        } catch (e: Exception) {
            AuthResult.Error(mapFirebaseError(e))
        }
    }

    /**
     * Firebase ID tokens expire (~1 hour); this is what every authenticated
     * API call must fetch fresh right before the request, rather than
     * caching one long-term. `forceRefresh = true` is used after a 401/
     * AUTH_EXPIRED response from the backend to get a guaranteed-fresh token
     * before deciding the session is actually invalid.
     */
    suspend fun getIdToken(forceRefresh: Boolean = false): String? {
        val user = firebaseAuth.currentUser ?: return null
        return try {
            user.getIdToken(forceRefresh).await().token
        } catch (e: Exception) {
            null
        }
    }

    suspend fun signOut() {
        firebaseAuth.signOut()
        sessionManager.clear()
    }

    /**
     * Deletes the Firebase Auth account itself. Firebase requires a RECENT
     * sign-in for this ("requires-recent-login" exception) — the caller
     * (DeleteAccountViewModel) must catch that specific failure and route
     * the user through reauthentication (re-enter password, or re-run the
     * Google credential flow) before retrying, per the Master Prompt's
     * "reauthentication when Firebase requires it" requirement. Deleting
     * the Firebase account is only step one — the caller must ALSO call
     * the backend's deleteAccount action (UID-authenticated) to remove the
     * Sheets-side data, mirroring the website's existing deleteAccount_.
     */
    suspend fun deleteFirebaseAccount(): AuthResult {
        val user = firebaseAuth.currentUser ?: return AuthResult.Error("Not signed in.")
        return try {
            user.delete().await()
            sessionManager.clear()
            AuthResult.Success(null)
        } catch (e: Exception) {
            AuthResult.Error(mapFirebaseError(e))
        }
    }

    fun toUserSession(user: FirebaseUser, isAdmin: Boolean, consentGiven: Boolean): UserSession = UserSession(
        uid = user.uid,
        email = user.email.orEmpty(),
        name = user.displayName ?: user.email?.substringBefore("@") ?: "Student",
        isAdmin = isAdmin,
        consentGiven = consentGiven,
    )

    /** Turns Firebase's internal exception messages into text a student can actually act on. */
    private fun mapFirebaseError(e: Exception): String {
        val msg = e.message ?: return "Something went wrong. Please try again."
        return when {
            msg.contains("no user record", ignoreCase = true) -> "No account found with that email."
            msg.contains("password is invalid", ignoreCase = true) -> "Incorrect password."
            msg.contains("email address is already in use", ignoreCase = true) -> "An account already exists with this email — try signing in instead."
            msg.contains("badly formatted", ignoreCase = true) -> "Enter a valid email address."
            msg.contains("weak password", ignoreCase = true) -> "Password is too weak — use at least 6 characters."
            msg.contains("network error", ignoreCase = true) -> "No internet connection. Please try again."
            msg.contains("requires-recent-login", ignoreCase = true) -> "For your security, please sign in again to confirm this action."
            msg.contains("too-many-requests", ignoreCase = true) -> "Too many attempts. Please wait a moment and try again."
            else -> msg
        }
    }
}

sealed class AuthResult {
    data class Success(val user: FirebaseUser?) : AuthResult()
    data class Error(val message: String) : AuthResult()
}
