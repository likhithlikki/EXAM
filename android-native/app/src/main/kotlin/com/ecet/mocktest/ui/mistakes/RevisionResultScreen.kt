package com.ecet.mocktest.ui.mistakes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun RevisionResultScreen(result: RevisionResultUi, onBackToMistakes: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(32.dp))
        Text("Revision Result", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Correct answers are removed from My Mistakes. Wrong or unanswered questions are scheduled again for 1 day.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(vertical = 16.dp),
        )
        Row(Modifier.fillMaxWidth()) {
            Tile("${result.correct}", "Correct", Modifier.weight(1f))
            Tile("${result.wrong}", "Wrong again", Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth()) {
            Tile("${result.unattempted}", "Unanswered", Modifier.weight(1f))
            Tile("${result.total}", "Total", Modifier.weight(1f))
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = onBackToMistakes, modifier = Modifier.fillMaxWidth()) { Text("Back to My Mistakes") }
    }
}

@Composable
private fun Tile(value: String, label: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier.padding(6.dp)) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge)
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
