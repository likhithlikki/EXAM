package com.ecet.mocktest.ui.mistakes

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
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
import com.ecet.mocktest.data.remote.MistakeDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MistakesScreen(
    viewModel: MistakesViewModel,
    email: String,
    onStartRevision: (List<MistakeDto>) -> Unit,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(email) { viewModel.load(email) }

    Scaffold(topBar = { TopAppBar(title = { Text("My Mistakes") }) }) { padding ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.errorMessage != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load your mistakes.")
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(email) }) { Text("Retry") }
                }
            }
            state.mistakes.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No active mistakes — excellent! 🎉", style = MaterialTheme.typography.titleMedium)
            }
            else -> {
                val due = viewModel.dueNow()
                Column(Modifier.fillMaxSize().padding(padding)) {
                    Text(
                        "Active mistakes: ${state.mistakes.size} • Due now: ${due.size}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(16.dp),
                    )
                    Button(
                        onClick = { onStartRevision(due) },
                        enabled = due.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    ) {
                        Text(if (due.isNotEmpty()) "Start revision test (${due.size})" else "Start revision test (not due yet)")
                    }
                    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                        items(state.mistakes) { mistake -> MistakeCard(mistake, isDue = due.any { it.wrongId == mistake.wrongId }) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MistakeCard(mistake: MistakeDto, isDue: Boolean) {
    Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(
                "${mistake.subject} • ${if (isDue) "Due now" else "Not due yet"}",
                style = MaterialTheme.typography.labelLarge,
                color = if (isDue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(mistake.question, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
