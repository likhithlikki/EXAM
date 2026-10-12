package com.ecet.mocktest.ui.history

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
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
import com.ecet.mocktest.data.remote.AttemptHistoryDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttemptHistoryScreen(viewModel: AttemptHistoryViewModel, email: String) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(email) { viewModel.load(email) }

    Scaffold(topBar = { TopAppBar(title = { Text("Attempt History") }) }) { padding ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.errorMessage != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load attempt history.")
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(email) }) { Text("Retry") }
                }
            }
            state.attempts.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No attempts yet.", style = MaterialTheme.typography.bodyMedium)
            }
            else -> Column(Modifier.fillMaxSize().padding(padding)) {
                Text(
                    "Every attempt is kept — nothing is overwritten. Tick two rows to compare.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp),
                )
                viewModel.compareAttempts()?.let { (a, b) -> CompareCard(a, b) }
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    items(state.attempts) { attempt ->
                        AttemptRow(
                            attempt = attempt,
                            checked = state.compareIds.contains(attempt.resultId),
                            onCheckedChange = { viewModel.toggleCompare(attempt.resultId) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AttemptRow(attempt: AttemptHistoryDto, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = checked, onCheckedChange = onCheckedChange)
            Column(Modifier.padding(start = 4.dp)) {
                Text(attempt.subject, style = MaterialTheme.typography.titleMedium)
                Text(
                    "${attempt.score}/${attempt.total} • ${"%.1f".format(attempt.percentage)}% • " +
                        (attempt.rank?.let { "Rank #$it" } ?: "Rank —"),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(attempt.endTime ?: attempt.timestamp, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun CompareCard(a: AttemptHistoryDto, b: AttemptHistoryDto) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text("Comparing two attempts", style = MaterialTheme.typography.titleMedium)
            CompareRow("Score", "${a.score}/${a.total}", "${b.score}/${b.total}")
            CompareRow("%", "${"%.1f".format(a.percentage)}%", "${"%.1f".format(b.percentage)}%", diff = b.percentage - a.percentage)
            CompareRow("Correct", "${a.correct}", "${b.correct}", diff = (b.correct - a.correct).toDouble())
            CompareRow("Wrong", "${a.wrong}", "${b.wrong}", diff = (b.wrong - a.wrong).toDouble())
        }
    }
}

@Composable
private fun CompareRow(label: String, first: String, second: String, diff: Double? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(first, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(second, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        if (diff != null) {
            val sign = if (diff > 0) "+" else ""
            Text(
                "$sign${"%.1f".format(diff)}",
                style = MaterialTheme.typography.bodyMedium,
                color = if (diff >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                modifier = Modifier.weight(1f),
            )
        }
    }
}
