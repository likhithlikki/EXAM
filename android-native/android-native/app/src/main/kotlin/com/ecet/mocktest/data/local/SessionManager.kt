package com.ecet.mocktest.data.local

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "mocktest_session")

/**
 * Small, non-sensitive session mirror — the SOURCE OF TRUTH for "who is
 * logged in" is always FirebaseAuth.getInstance().currentUser (see
 * AuthRepository). This DataStore copy exists only so the UI can show the
 * right screen (splash -> Login vs Home) instantly, and so a background
 * WorkManager job (outbox sync) can know the current UID without needing
 * Firebase fully initialized off the main thread. It stores no password,
 * no ID token, and no secret — only what's already visible in the UI.
 */
class SessionManager(private val context: Context) {

    private object Keys {
        val UID = stringPreferencesKey("uid")
        val EMAIL = stringPreferencesKey("email")
        val NAME = stringPreferencesKey("name")
        val IS_ADMIN = booleanPreferencesKey("is_admin") // server-confirmed, refreshed on every login — see AuthRepository
        val CONSENT_GIVEN = booleanPreferencesKey("consent_given")
    }

    val uidFlow: Flow<String?> = context.dataStore.data.map { it[Keys.UID] }
    val sessionFlow: Flow<UserSession?> = context.dataStore.data.map { prefs ->
        val uid = prefs[Keys.UID] ?: return@map null
        UserSession(
            uid = uid,
            email = prefs[Keys.EMAIL].orEmpty(),
            name = prefs[Keys.NAME].orEmpty(),
            isAdmin = prefs[Keys.IS_ADMIN] ?: false,
            consentGiven = prefs[Keys.CONSENT_GIVEN] ?: false,
        )
    }

    suspend fun save(session: UserSession) {
        context.dataStore.edit { prefs ->
            prefs[Keys.UID] = session.uid
            prefs[Keys.EMAIL] = session.email
            prefs[Keys.NAME] = session.name
            prefs[Keys.IS_ADMIN] = session.isAdmin
            prefs[Keys.CONSENT_GIVEN] = session.consentGiven
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}

data class UserSession(
    val uid: String,
    val email: String,
    val name: String,
    val isAdmin: Boolean,
    val consentGiven: Boolean,
)
