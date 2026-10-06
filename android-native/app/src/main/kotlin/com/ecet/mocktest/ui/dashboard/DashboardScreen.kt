package com.ecet.mocktest.ui.dashboard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import com.ecet.mocktest.data.remote.SubjectStatDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(viewModel: DashboardViewModel, email: String, onBack: () -> Unit, onOpenAttemptHistory: () -> Unit) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(email) { viewModel.load(email) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Dashboard") },
                actions = { androidx.compose.material3.TextButton(onClick = onOpenAttemptHistory) { Text("Full history") } },
            )
        },
    ) { padding ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.errorMessage != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load your dashboard.")
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(email) }) { Text("Retry") }
                }
            }
            else -> {
                val dashboard = state.dashboard
                LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                    item {
                        Row(Modifier.fillMaxWidth()) {
                            StatTile("${dashboard?.attempts ?: 0}", "Tests taken", Modifier.weight(1f))
                            StatTile("${"%.1f".format(dashboard?.avg ?: 0.0)}%", "Average %", Modifier.weight(1f))
                        }
                        Row(Modifier.fillMaxWidth()) {
                            StatTile("${"%.1f".format(dashboard?.best ?: 0.0)}%", "Best %", Modifier.weight(1f))
                            StatTile("${dashboard?.mistakes ?: 0}", "Active mistakes", Modifier.weight(1f))
                        }
                        Text(
                            "Subject-wise performance",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
                        )
                    }
                    if (dashboard?.subjects.isNullOrEmpty()) {
                        item { Text("No attempts yet.", style = MaterialTheme.typography.bodyMedium) }
                    } else {
                        items(dashboard!!.subjects) { subject -> SubjectRow(subject) }
                    }
                }
            }
        }
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

@Composable
private fun SubjectRow(subject: SubjectStatDto) {
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(subject.subject, style = MaterialTheme.typography.titleMedium)
            Text(
                "Attempts ${subject.attempts} • Best ${"%.1f".format(subject.best)}% • Avg ${"%.1f".format(subject.avg)}%",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
