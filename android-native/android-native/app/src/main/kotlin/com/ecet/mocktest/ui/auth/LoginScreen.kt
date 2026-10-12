package com.ecet.mocktest.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Every field uses OutlinedTextField's built-in `label`, which Compose ties
 * to the input for accessibility automatically (the native equivalent of
 * fixing the website's unlinked <label>/<input> pairs) — no separate
 * association step is needed the way it was in HTML.
 */
@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    onSignedIn: () -> Unit,
    onOpenPrivacyPolicy: () -> Unit,
    onOpenTerms: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val activityContext = LocalContext.current // the hosting Activity — required by Credential Manager

    LaunchedEffect(state.signedIn) {
        if (state.signedIn) onSignedIn()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Online Mock Test",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(top = 48.dp, bottom = 8.dp),
        )
        Text(
            text = if (state.mode == AuthMode.SIGN_IN) "Sign in to continue" else "Create your account",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(bottom = 24.dp),
        )

        if (state.mode == AuthMode.CREATE_ACCOUNT) {
            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::onNameChange,
                label = { Text("Name") },
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                singleLine = true,
            )
        }

        OutlinedTextField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = { Text("Email") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            singleLine = true,
        )

        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            singleLine = true,
        )

        if (state.mode == AuthMode.SIGN_IN) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = viewModel::sendPasswordReset) {
                    Text("Forgot password?")
                }
            }
        }

        // ---- Consent (DPDP Act) — mandatory before any sign-in/sign-up submits ----
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
                .semantics { contentDescription = "Agree to Privacy Policy and Terms and Conditions" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = state.consentChecked, onCheckedChange = viewModel::onConsentToggle)
            Column {
                Row {
                    TextButton(onClick = onOpenPrivacyPolicy, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                        Text("Privacy Policy", style = MaterialTheme.typography.labelLarge)
                    }
                    Text(" & ", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
                    TextButton(onClick = onOpenTerms, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                        Text("Terms", style = MaterialTheme.typography.labelLarge)
                    }
                }
                Text("I consent to my name and email being stored to provide this service.", style = MaterialTheme.typography.bodyMedium)
            }
        }

        if (state.errorMessage != null) {
            Text(
                text = state.errorMessage!!,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 8.dp).semantics { contentDescription = "Error: ${state.errorMessage}" },
            )
        }
        if (state.infoMessage != null) {
            Text(text = state.infoMessage!!, modifier = Modifier.padding(vertical = 8.dp))
        }

        if (state.isLoading) {
            CircularProgressIndicator(modifier = Modifier.padding(16.dp).size(32.dp))
        } else {
            Button(
                onClick = viewModel::submitEmailPassword,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) {
                Text(if (state.mode == AuthMode.SIGN_IN) "Sign in" else "Create account")
            }

            Divider(modifier = Modifier.padding(vertical = 20.dp))

            OutlinedButton(
                onClick = { viewModel.signInWithGoogle(activityContext) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Continue with Google")
            }
        }

        TextButton(onClick = viewModel::onModeToggle, modifier = Modifier.padding(top = 20.dp)) {
            Text(
                if (state.mode == AuthMode.SIGN_IN) "Don't have an account? Create one"
                else "Already have an account? Sign in",
            )
        }
    }
}
