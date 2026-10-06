package com.ecet.mocktest.ui.mistakes

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun RevisionScreen(viewModel: RevisionViewModel, onFinished: (RevisionResultUi) -> Unit) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.phase) {
        if (state.phase == RevisionPhase.RESULT) {
            state.result?.let(onFinished)
        }
    }

    when (state.phase) {
        RevisionPhase.SUBMITTING -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        RevisionPhase.ERROR -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Could not save your revision result.")
                Text(state.errorMessage ?: "")
                Button(onClick = viewModel::submit) { Text("Try again") }
            }
        }
        RevisionPhase.RESULT -> { /* handled by LaunchedEffect above */ }
        RevisionPhase.IN_PROGRESS -> {
            val question = state.questions.getOrNull(state.currentIndex) ?: return
            val minutes = state.secondsLeft / 60
            val seconds = state.secondsLeft % 60

            Column(Modifier.fillMaxSize().padding(16.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("1-Day Revision Test", style = MaterialTheme.typography.titleMedium)
                    Text(
                        String.format("%02d:%02d", minutes, seconds),
                        color = if (state.secondsLeft <= 60) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    )
                }
                Text(
                    "Question ${state.currentIndex + 1} of ${state.questions.size} • Answered ${state.answers.size}/${state.questions.size}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
                Text(question.question, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(bottom = 12.dp))

                question.options.forEachIndexed { index, optionText ->
                    val selected = state.answers[state.currentIndex] == index
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .selectable(selected = selected, onClick = { viewModel.selectAnswer(index) })
                            .border(1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = selected, onClick = { viewModel.selectAnswer(index) })
                        Text(optionText, modifier = Modifier.padding(start = 8.dp))
                    }
                }

                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    OutlinedButton(onClick = { viewModel.goTo(state.currentIndex - 1) }, enabled = state.currentIndex > 0) { Text("◀ Previous") }
                    OutlinedButton(onClick = { viewModel.goTo(state.currentIndex + 1) }, enabled = state.currentIndex < state.questions.size - 1) { Text("Next ▶") }
                    Button(onClick = viewModel::submit) { Text("Finish") }
                }
            }
        }
    }
}
