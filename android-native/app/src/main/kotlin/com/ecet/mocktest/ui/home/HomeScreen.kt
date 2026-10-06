package com.ecet.mocktest.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.SubjectDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    session: UserSession,
    onOpenSubject: (SubjectDto) -> Unit,
    onOpenProfile: () -> Unit,
    onOpenDashboard: () -> Unit,
    onOpenMistakes: () -> Unit,
    onOpenReminders: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(session.email) { viewModel.load(session) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Hi, ${session.name.ifBlank { "Student" }}") },
                actions = {
                    TextButton(onClick = onOpenReminders) { Text("Reminders") }
                    TextButton(onClick = onOpenMistakes) { Text("Mistakes") }
                    TextButton(onClick = onOpenDashboard) { Text("Dashboard") }
                    TextButton(onClick = onOpenProfile) { Text("Profile") }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {

            if (state.outboxPendingCount > 0) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp)
                        .semantics { contentDescription = "${state.outboxPendingCount} results saved offline, will upload automatically" },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Filled.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                    Text(
                        " ${state.outboxPendingCount} result(s) saved offline — will upload automatically.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }

            when {
                state.isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                state.errorMessage != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Couldn't load your subjects.", style = MaterialTheme.typography.titleMedium)
                        Text(state.errorMessage ?: "", style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { viewModel.load(session) }) { Text("Retry") }
                    }
                }
                state.bundle?.customSubjects.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No subjects available yet.", style = MaterialTheme.typography.bodyMedium)
                }
                else -> LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    items(state.bundle!!.customSubjects) { subject ->
                        SubjectCard(subject = subject, onClick = { onOpenSubject(subject) })
                    }
                }
            }
        }
    }
}

@Composable
private fun SubjectCard(subject: SubjectDto, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(subject.name, style = MaterialTheme.typography.titleMedium)
            if (!subject.description.isNullOrBlank()) {
                Text(subject.description, style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                "${subject.questionCount} question(s)",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
