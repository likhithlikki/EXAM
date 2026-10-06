package com.ecet.mocktest.ui.reminders

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ecet.mocktest.data.remote.NotificationDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(viewModel: NotificationsViewModel, email: String) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(email) { viewModel.load(email) }

    Scaffold(topBar = { TopAppBar(title = { Text("Notification History") }) }) { padding ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.errorMessage != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load notification history.")
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(email) }) { Text("Retry") }
                }
            }
            state.notifications.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No notifications yet.", style = MaterialTheme.typography.bodyMedium)
            }
            else -> LazyColumn(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                items(state.notifications) { n -> NotificationCard(n, isRetrying = state.retryingId == n.id, onRetry = { viewModel.retry(n.id) }) }
            }
        }
    }
}

@Composable
private fun NotificationCard(n: NotificationDto, isRetrying: Boolean, onRetry: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(
                n.status.ifBlank { "Pending" },
                style = MaterialTheme.typography.labelLarge,
                color = if (n.status == "Failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
            Text(n.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
            Text(n.message, style = MaterialTheme.typography.bodyMedium)
            if (n.status == "Failed") {
                Text(
                    "Reason: ${n.error.ifBlank { "Unknown error" }}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 4.dp),
                )
                TextButton(onClick = onRetry, enabled = !isRetrying) { Text(if (isRetrying) "Retrying…" else "Retry") }
            }
        }
    }
}
