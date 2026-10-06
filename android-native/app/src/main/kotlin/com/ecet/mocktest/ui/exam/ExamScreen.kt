package com.ecet.mocktest.ui.exam

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
fun ExamScreen(viewModel: ExamViewModel, onLocked: (String?) -> Unit, onFinished: () -> Unit) {
    val state by viewModel.uiState.collectAsState()
    var showSubmitConfirm by remember { mutableStateOf(false) }

    when (state.phase) {
        ExamPhase.LOADING, ExamPhase.SUBMITTING -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Text(
                    if (state.phase == ExamPhase.SUBMITTING) "Submitting…" else "Loading questions…",
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
        ExamPhase.LOCKED -> {
            LaunchedEffect(state.lockedUntil) { onLocked(state.lockedUntil) }
        }
        ExamPhase.ERROR -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(state.errorMessage ?: "Something went wrong.")
        }
        ExamPhase.RESULT -> {
            LaunchedEffect(Unit) { onFinished() }
        }
        ExamPhase.IN_PROGRESS -> {
            val question = state.questions.getOrNull(state.currentIndex) ?: return
            val minutes = state.secondsLeft / 60
            val seconds = state.secondsLeft % 60

            Column(Modifier.fillMaxSize().padding(16.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Question ${state.currentIndex + 1} / ${state.questions.size}",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        String.format("%02d:%02d", minutes, seconds),
                        style = MaterialTheme.typography.titleMedium,
                        color = if (state.secondsLeft <= 60) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.semantics { contentDescription = "Time remaining $minutes minutes $seconds seconds" },
                    )
                }

                Text(
                    question.question,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(vertical = 16.dp),
                )

                question.options.forEachIndexed { index, optionText ->
                    val selected = state.answers[state.currentIndex] == index
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .selectable(selected = selected, onClick = { viewModel.selectAnswer(index) })
                            .border(
                                width = 1.dp,
                                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(10.dp),
                            )
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = selected, onClick = { viewModel.selectAnswer(index) })
                        Text(optionText, modifier = Modifier.padding(start = 8.dp))
                    }
                }

                TextButton(onClick = viewModel::toggleMark, modifier = Modifier.padding(top = 8.dp)) {
                    Text(if (state.marked.contains(state.currentIndex)) "★ Marked for review" else "☆ Mark for review")
                }

                Text(
                    "Answered ${state.answers.size}/${state.questions.size} • Review ${state.marked.size}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 8.dp),
                )

                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                ) {
                    items(state.questions.size) { index ->
                        val answered = state.answers.containsKey(index)
                        val marked = state.marked.contains(index)
                        val bg = when {
                            marked -> MaterialTheme.colorScheme.secondary
                            answered -> MaterialTheme.colorScheme.tertiaryContainer
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                        Box(
                            modifier = Modifier
                                .padding(2.dp)
                                .size(32.dp)
                                .aspectRatio(1f)
                                .background(bg, CircleShape)
                                .clickable { viewModel.goTo(index) }
                                .semantics { contentDescription = "Question ${index + 1}${if (answered) ", answered" else ""}${if (marked) ", marked for review" else ""}" },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("${index + 1}", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    OutlinedButton(
                        onClick = { viewModel.goTo(state.currentIndex - 1) },
                        enabled = state.currentIndex > 0,
                    ) { Text("◀ Previous") }
                    OutlinedButton(
                        onClick = { viewModel.goTo(state.currentIndex + 1) },
                        enabled = state.currentIndex < state.questions.size - 1,
                    ) { Text("Next ▶") }
                    Button(onClick = { showSubmitConfirm = true }) { Text("Submit") }
                }
            }

            if (showSubmitConfirm) {
                val unanswered = state.questions.size - state.answers.size
                AlertDialog(
                    onDismissRequest = { showSubmitConfirm = false },
                    title = { Text("Submit exam?") },
                    text = {
                        Text(
                            if (unanswered > 0) "You have $unanswered unanswered question(s). Submit anyway?"
                            else "Submit your exam now?",
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { showSubmitConfirm = false; viewModel.submit() }) { Text("Submit") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showSubmitConfirm = false }) { Text("Cancel") }
                    },
                )
            }
        }
    }
}
