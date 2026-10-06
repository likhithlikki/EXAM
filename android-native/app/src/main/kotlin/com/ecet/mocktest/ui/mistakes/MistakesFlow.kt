package com.ecet.mocktest.ui.mistakes

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ecet.mocktest.data.remote.MistakeDto
import com.ecet.mocktest.data.repository.ExamRepository

private enum class LocalPhase { MISTAKES, REVISION, REVISION_RESULT }

/**
 * Mistakes -> Revision -> Result lives in ONE composable with local phase
 * state rather than three separate NavHost routes, because the due-items
 * list the revision test needs is not cheaply serializable into a nav route
 * argument (Compose Navigation route args are strings) and re-fetching it
 * at the start of the revision screen would be a pointless extra network
 * call for data MistakesViewModel already has in memory. `onBack` is only
 * reachable from the MISTAKES phase — mid-revision back navigation is
 * intentionally not exposed here, mirroring the website's same back-guard
 * reasoning for an in-progress timed test (see ExamScreen/ExamViewModel).
 */
@Composable
fun MistakesFlow(examRepository: ExamRepository, email: String, onBack: () -> Unit) {
    var phase by remember { mutableStateOf(LocalPhase.MISTAKES) }
    var revisionItems by remember { mutableStateOf<List<MistakeDto>>(emptyList()) }
    var lastResult by remember { mutableStateOf<RevisionResultUi?>(null) }

    when (phase) {
        LocalPhase.MISTAKES -> {
            val vm: MistakesViewModel = viewModel(factory = simpleFactoryMistakes { MistakesViewModel(examRepository) })
            MistakesScreen(
                viewModel = vm,
                email = email,
                onStartRevision = { due ->
                    revisionItems = due
                    phase = LocalPhase.REVISION
                },
                onBack = onBack,
            )
        }
        LocalPhase.REVISION -> {
            val vm: RevisionViewModel = viewModel(factory = simpleFactoryMistakes { RevisionViewModel(examRepository) })
            androidx.compose.runtime.LaunchedEffect(revisionItems) { vm.start(email, revisionItems) }
            RevisionScreen(
                viewModel = vm,
                onFinished = { result ->
                    lastResult = result
                    phase = LocalPhase.REVISION_RESULT
                },
            )
        }
        LocalPhase.REVISION_RESULT -> {
            lastResult?.let { result ->
                RevisionResultScreen(result = result, onBackToMistakes = { phase = LocalPhase.MISTAKES })
            }
        }
    }
}

private fun <T : androidx.lifecycle.ViewModel> simpleFactoryMistakes(creator: () -> T): androidx.lifecycle.ViewModelProvider.Factory =
    object : androidx.lifecycle.ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <U : androidx.lifecycle.ViewModel> create(modelClass: Class<U>): U = creator() as U
    }
