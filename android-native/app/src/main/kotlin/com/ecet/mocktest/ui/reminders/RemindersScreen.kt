package com.ecet.mocktest.ui.reminders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.ReminderDto
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemindersScreen(
    viewModel: RemindersViewModel,
    session: UserSession,
    onOpenNotifications: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(session.email) { viewModel.load(session) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Reminders") }, actions = { TextButton(onClick = onOpenNotifications) { Text("History") } }) },
        floatingActionButton = {
            FloatingActionButton(onClick = viewModel::openCreateForm) { Icon(Icons.Filled.Add, contentDescription = "New reminder") }
        },
    ) { padding ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.errorMessage != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Couldn't load reminders.")
                    Text(state.errorMessage ?: "")
                    TextButton(onClick = { viewModel.load(session) }) { Text("Retry") }
                }
            }
            state.reminders.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No reminders yet. Tap + to create one.", style = MaterialTheme.typography.bodyMedium)
            }
            else -> LazyColumn(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                items(state.reminders) { reminder ->
                    ReminderCard(
                        reminder = reminder,
                        onEdit = { viewModel.openEditForm(reminder) },
                        onToggle = { viewModel.toggle(reminder) },
                        onDelete = { viewModel.delete(reminder) },
                    )
                }
            }
        }
    }

    if (state.form.visible) {
        ReminderFormDialog(viewModel = viewModel, form = state.form)
    }
}

@Composable
private fun ReminderCard(reminder: ReminderDto, onEdit: () -> Unit, onToggle: () -> Unit, onDelete: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(reminder.status, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(reminder.frequency, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(reminder.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
            Text(reminder.message, style = MaterialTheme.typography.bodyMedium)
            Text(
                "Next: ${formatIsoOrDash(reminder.nextRunAt)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
            Row(Modifier.padding(top = 8.dp)) {
                TextButton(onClick = onEdit) { Text("Edit") }
                TextButton(onClick = onToggle) { Text(if (reminder.enabled) "Pause" else "Resume") }
                TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderFormDialog(viewModel: RemindersViewModel, form: ReminderFormState) {
    AlertDialog(
        onDismissRequest = viewModel::closeForm,
        title = { Text(if (form.editingId == null) "New reminder" else "Edit reminder") },
        text = {
            Column {
                OutlinedTextField(
                    value = form.name, onValueChange = viewModel::onFormNameChange,
                    label = { Text("Related task / name") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                )
                OutlinedTextField(
                    value = form.message, onValueChange = viewModel::onFormMessageChange,
                    label = { Text("Message") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true,
                )
                OutlinedTextField(
                    value = form.relatedUrl, onValueChange = viewModel::onFormUrlChange,
                    label = { Text("Related URL (optional)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true,
                )

                Text("When", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 12.dp))
                Row(Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = viewModel::quickPickIn1Hour, modifier = Modifier.weight(1f).padding(2.dp)) { Text("1h", style = MaterialTheme.typography.labelLarge) }
                    OutlinedButton(onClick = viewModel::quickPickIn3Hours, modifier = Modifier.weight(1f).padding(2.dp)) { Text("3h", style = MaterialTheme.typography.labelLarge) }
                    OutlinedButton(onClick = viewModel::quickPickTomorrow, modifier = Modifier.weight(1f).padding(2.dp)) { Text("Tomorrow", style = MaterialTheme.typography.labelLarge) }
                }
                Text(
                    form.nextRunAtMillis?.let { "Scheduled: ${formatIsoOrDash(Instant.ofEpochMilli(it).toString())}" } ?: "No time selected yet",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 4.dp),
                )

                Text("Repeat", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    REMINDER_FREQUENCIES.forEach { (value, label) ->
                        FilterChip(
                            selected = form.frequency == value,
                            onClick = { viewModel.onFormFrequencyChange(value) },
                            label = { Text(label) },
                            modifier = Modifier.padding(end = 6.dp),
                        )
                    }
                }

                if (form.error != null) {
                    Text(form.error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = viewModel::saveForm, enabled = !form.isSaving) {
                Text(if (form.isSaving) "Saving…" else if (form.editingId == null) "Create" else "Save")
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeForm) { Text("Cancel") } },
    )
}

private fun formatIsoOrDash(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return runCatching {
        DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a").withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
    }.getOrDefault(iso)
}
