package com.ecet.mocktest.ui.result

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ecet.mocktest.ui.exam.ExamResultUi

@Composable
fun ResultScreen(result: ExamResultUi, onBackToHome: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Text("Your Result", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(20.dp))

        if (result.offlinePending) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            ) {
                Text(
                    "📡 No internet — this result is saved on your device and will upload automatically once you're back online. Rank will appear after it syncs.",
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        Row(Modifier.fillMaxWidth()) {
            StatTile("${result.score}/${result.total}", "Score", Modifier.weight(1f))
            StatTile("${"%.1f".format(result.percentage)}%", "Percentage", Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth()) {
            StatTile(result.rank?.let { "#$it" } ?: "—", "Rank", Modifier.weight(1f))
            StatTile(result.expectedRank ?: "—", "Expected Rank", Modifier.weight(1f))
        }

        Spacer(Modifier.height(32.dp))
        Button(onClick = onBackToHome, modifier = Modifier.fillMaxWidth()) {
            Text("Back to Subjects")
        }
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier.padding(6.dp)) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
