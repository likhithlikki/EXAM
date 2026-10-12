package com.ecet.mocktest.ui.reminders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.data.remote.ReminderDto
import com.ecet.mocktest.data.repository.ExamRepository
import com.ecet.mocktest.data.repository.RepoResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

val REMINDER_FREQUENCIES = listOf(
    "once" to "One-time",
    "hourly" to "Hourly",
    "daily" to "Daily",
    "weekly" to "Weekly",
    "monthly" to "Monthly",
)

data class ReminderFormState(
    val visible: Boolean = false,
    val editingId: String? = null,
    val name: String = "",
    val message: String = "",
    val relatedUrl: String = "",
    val frequency: String = "once",
    val nextRunAtMillis: Long? = null,
    val error: String? = null,
    val isSaving: Boolean = false,
)

data class RemindersUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val reminders: List<ReminderDto> = emptyList(),
    val form: ReminderFormState = ReminderFormState(),
    val actionError: String? = null,
)

/**
 * Standalone reminders — not tied to any specific test, mirroring the
 * website's remindersPage()/reminderFormHTML() section exactly, including
 * the "In 1 hour / In 3 hours / Tomorrow" quick-pick buttons as the primary
 * way to set a time (a full custom calendar+clock picker dialog was not
 * built in this pass — see IMPLEMENTATION_REPORT.md "Known simplifications").
 */
class RemindersViewModel(private val examRepository: ExamRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(RemindersUiState())
    val uiState: StateFlow<RemindersUiState> = _uiState.asStateFlow()

    private lateinit var session: UserSession

    fun load(session: UserSession) {
        this.session = session
        _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            when (val result = examRepository.loadReminders(session.email)) {
                is RepoResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, reminders = result.value)
                is RepoResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = result.message)
            }
        }
    }

    fun openCreateForm() {
        _uiState.value = _uiState.value.copy(form = ReminderFormState(visible = true))
    }

    fun openEditForm(reminder: ReminderDto) {
        val millis = reminder.nextRunAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        _uiState.value = _uiState.value.copy(
            form = ReminderFormState(
                visible = true,
                editingId = reminder.id,
                name = reminder.name,
                message = reminder.message,
                relatedUrl = reminder.relatedUrl,
                frequency = reminder.frequency,
                nextRunAtMillis = millis,
            ),
        )
    }

    fun closeForm() {
        _uiState.value = _uiState.value.copy(form = ReminderFormState())
    }

    fun onFormNameChange(v: String) { updateForm { it.copy(name = v) } }
    fun onFormMessageChange(v: String) { updateForm { it.copy(message = v) } }
    fun onFormUrlChange(v: String) { updateForm { it.copy(relatedUrl = v) } }
    fun onFormFrequencyChange(v: String) { updateForm { it.copy(frequency = v) } }

    fun quickPickIn1Hour() { updateForm { it.copy(nextRunAtMillis = Instant.now().plus(1, ChronoUnit.HOURS).toEpochMilli()) } }
    fun quickPickIn3Hours() { updateForm { it.copy(nextRunAtMillis = Instant.now().plus(3, ChronoUnit.HOURS).toEpochMilli()) } }
    fun quickPickTomorrow() { updateForm { it.copy(nextRunAtMillis = Instant.now().plus(24, ChronoUnit.HOURS).toEpochMilli()) } }

    private fun updateForm(transform: (ReminderFormState) -> ReminderFormState) {
        _uiState.value = _uiState.value.copy(form = transform(_uiState.value.form))
    }

    fun saveForm() {
        val form = _uiState.value.form
        if (form.name.isBlank() || form.message.isBlank()) {
            updateForm { it.copy(error = "Name and message are required.") }
            return
        }
        val whenMillis = form.nextRunAtMillis
        if (whenMillis == null || whenMillis <= System.currentTimeMillis()) {
            updateForm { it.copy(error = "Pick a valid future date/time.") }
            return
        }
        updateForm { it.copy(isSaving = true, error = null) }
        val nextRunAtIso = Instant.ofEpochMilli(whenMillis).toString()

        viewModelScope.launch {
            val result = if (form.editingId == null) {
                examRepository.createReminder(
                    email = session.email, userName = session.name, name = form.name, message = form.message,
                    relatedTask = form.name, relatedUrl = form.relatedUrl, frequency = form.frequency, nextRunAtIso = nextRunAtIso,
                )
            } else {
                examRepository.updateReminder(
                    email = session.email, id = form.editingId, userName = session.name, name = form.name, message = form.message,
                    relatedTask = form.name, relatedUrl = form.relatedUrl, frequency = form.frequency, nextRunAtIso = nextRunAtIso,
                )
            }
            when (result) {
                is RepoResult.Success -> {
                    closeForm()
                    load(session)
                }
                is RepoResult.Error -> updateForm { it.copy(isSaving = false, error = result.message) }
            }
        }
    }

    fun toggle(reminder: ReminderDto) {
        viewModelScope.launch {
            val result = examRepository.toggleReminder(session.email, reminder.id, !reminder.enabled)
            if (result is RepoResult.Error) _uiState.value = _uiState.value.copy(actionError = result.message)
            load(session)
        }
    }

    fun delete(reminder: ReminderDto) {
        viewModelScope.launch {
            val result = examRepository.deleteReminder(session.email, reminder.id)
            if (result is RepoResult.Error) _uiState.value = _uiState.value.copy(actionError = result.message)
            load(session)
        }
    }
}
