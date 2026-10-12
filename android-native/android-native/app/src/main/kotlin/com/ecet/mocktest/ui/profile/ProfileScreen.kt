package com.ecet.mocktest.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ecet.mocktest.data.local.UserSession

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    viewModel: ProfileViewModel,
    session: UserSession,
    onBack: () -> Unit,
    onSignedOut: () -> Unit,
    onAccountDeleted: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val activityContext = LocalContext.current

    LaunchedEffect(session.email) { viewModel.load(session) }
    LaunchedEffect(state.deleteStep) {
        if (state.deleteStep == DeleteStep.DONE) onAccountDeleted()
    }

    Scaffold(topBar = { TopAppBar(title = { Text("My Profile") }) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),
        ) {
            when {
                state.isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                state.errorMessage != null -> Column {
                    Text("Couldn't load your profile.", style = MaterialTheme.typography.titleMedium)
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(session) }) { Text("Retry") }
                }
                else -> {
                    val profile = state.profile
                    Text(session.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

                    OutlinedTextField(
                        value = state.editingName,
                        onValueChange = viewModel::onNameChange,
                        label = { Text("Name") },
                        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                        singleLine = true,
                    )
                    if (state.saveError != null) {
                        Text(state.saveError ?: "", color = MaterialTheme.colorScheme.error)
                    }
                    Button(
                        onClick = viewModel::saveName,
                        enabled = !state.isSavingName,
                        modifier = Modifier.padding(top = 8.dp),
                    ) { Text(if (state.isSavingName) "Saving…" else "Save name") }

                    if (profile != null) {
                        Row(Modifier.fillMaxWidth().padding(top = 24.dp)) {
                            StatTile("${profile.attempts}", "Exams taken", Modifier.weight(1f))
                            StatTile("${"%.1f".format(profile.avg)}%", "Average", Modifier.weight(1f))
                        }
                        Row(Modifier.fillMaxWidth()) {
                            StatTile("${"%.1f".format(profile.best)}%", "Best", Modifier.weight(1f))
                            StatTile("${profile.mistakes}", "Active mistakes", Modifier.weight(1f))
                        }
                    }

                    OutlinedButton(
                        onClick = { viewModel.signOut(onSignedOut) },
                        modifier = Modifier.fillMaxWidth().padding(top = 28.dp),
                    ) { Text("Sign out") }

                    Text(
                        "Danger zone",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 28.dp, bottom = 6.dp),
                    )
                    Text(
                        "Permanently deletes your account and every result, mistake, and reminder tied to it. This cannot be undone.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(
                        onClick = viewModel::requestDelete,
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    ) { Text("Delete account") }
                }
            }
        }
    }

    when (state.deleteStep) {
        DeleteStep.CONFIRM -> AlertDialog(
            onDismissRequest = viewModel::cancelDelete,
            title = { Text("Delete your account?") },
            text = {
                Column {
                    Text("This permanently removes your account and all exam history, mistakes, and reminders. This cannot be undone.")
                    if (state.deleteError != null) {
                        Text(state.deleteError ?: "", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (state.deleteError != null && state.isGoogleProvider) {
                        viewModel.reauthenticateWithGoogle(activityContext)
                    } else {
                        viewModel.confirmDelete()
                    }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = viewModel::cancelDelete) { Text("Cancel") } },
        )
        DeleteStep.REAUTH_PASSWORD -> {
            var password by remember { mutableStateOf("") }
            AlertDialog(
                onDismissRequest = viewModel::cancelDelete,
                title = { Text("Confirm it's you") },
                text = {
                    Column {
                        Text("For your security, please re-enter your password to delete your account.")
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Password") },
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            singleLine = true,
                        )
                        if (state.deleteError != null) {
                            Text(state.deleteError ?: "", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { viewModel.reauthenticateWithPassword(password) }) { Text("Confirm & delete") }
                },
                dismissButton = { TextButton(onClick = viewModel::cancelDelete) { Text("Cancel") } },
            )
        }
        DeleteStep.DELETING -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Deleting your account…") },
            text = { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } },
            confirmButton = {},
        )
        else -> {}
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier.padding(4.dp)) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge)
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
