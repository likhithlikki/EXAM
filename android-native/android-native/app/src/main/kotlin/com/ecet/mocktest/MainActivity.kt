package com.ecet.mocktest

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.ecet.mocktest.data.local.UserSession
import com.ecet.mocktest.ui.auth.LoginScreen
import com.ecet.mocktest.ui.auth.LoginViewModel
import com.ecet.mocktest.ui.common.LockedScreen
import com.ecet.mocktest.ui.dashboard.DashboardScreen
import com.ecet.mocktest.ui.dashboard.DashboardViewModel
import com.ecet.mocktest.ui.exam.ExamPhase
import com.ecet.mocktest.ui.exam.ExamScreen
import com.ecet.mocktest.ui.exam.ExamViewModel
import com.ecet.mocktest.ui.history.AttemptHistoryScreen
import com.ecet.mocktest.ui.history.AttemptHistoryViewModel
import com.ecet.mocktest.ui.home.HomeScreen
import com.ecet.mocktest.ui.home.HomeViewModel
import com.ecet.mocktest.ui.mistakes.MistakesFlow
import com.ecet.mocktest.ui.profile.ProfileScreen
import com.ecet.mocktest.ui.profile.ProfileViewModel
import com.ecet.mocktest.ui.reminders.NotificationsScreen
import com.ecet.mocktest.ui.reminders.NotificationsViewModel
import com.ecet.mocktest.ui.reminders.RemindersScreen
import com.ecet.mocktest.ui.reminders.RemindersViewModel
import com.ecet.mocktest.ui.result.ResultScreen
import com.ecet.mocktest.ui.theme.MockTestTheme

private object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val PROFILE = "profile"
    const val DASHBOARD = "dashboard"
    const val MISTAKES = "mistakes"
    const val REMINDERS = "reminders"
    const val NOTIFICATIONS = "notifications"
    const val ATTEMPT_HISTORY = "attemptHistory"
    const val EXAM_FLOW = "examFlow/{subjectId}/{subjectName}"
    fun examFlow(subjectId: String, subjectName: String) = "examFlow/$subjectId/${Uri.encode(subjectName)}"
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Real session-restoration gate: the OS splash screen stays visible
        // until we know synchronously whether a Firebase session already
        // exists, so the very first composed frame is either Home or Login
        // — never a flash of the wrong one, and never an artificial delay
        // (FirebaseAuth.currentUser is a synchronous, already-initialized
        // check by the time Application.onCreate has run).
        val splash = installSplashScreen()
        var isReady = false
        splash.setKeepOnScreenCondition { !isReady }

        super.onCreate(savedInstanceState)
        val app = application as MockTestApplication
        isReady = true

        setContent {
            MockTestTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    MockTestNavHost(app)
                }
            }
        }
    }
}

@Composable
private fun MockTestNavHost(app: MockTestApplication) {
    val navController = rememberNavController()
    val startDestination = if (app.authRepository.hasSession()) Routes.HOME else Routes.LOGIN

    NavHost(navController = navController, startDestination = startDestination) {

        composable(Routes.LOGIN) {
            val vm: LoginViewModel = viewModel(
                factory = simpleFactory { LoginViewModel(app.authRepository, app.apiService, app.sessionManager) },
            )
            LoginScreen(
                viewModel = vm,
                onSignedIn = {
                    navController.navigate(Routes.HOME) { popUpTo(Routes.LOGIN) { inclusive = true } }
                },
                onOpenPrivacyPolicy = { openWebsitePage(navController, "privacy.html") },
                onOpenTerms = { openWebsitePage(navController, "terms.html") },
            )
        }

        composable(Routes.HOME) {
            // Reactive collection of the DataStore session — never a
            // blocking read on the main thread. Falls back to whatever
            // Firebase itself currently knows while the DataStore write
            // from a just-completed sign-in is still catching up.
            val storedSession by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val firebaseUser = app.authRepository.currentUser

            when {
                storedSession != null -> HomeRoute(app, storedSession!!, navController)
                firebaseUser != null -> HomeRoute(
                    app,
                    UserSession(
                        uid = firebaseUser.uid,
                        email = firebaseUser.email.orEmpty(),
                        name = firebaseUser.displayName ?: firebaseUser.email?.substringBefore("@") ?: "Student",
                        isAdmin = false,
                        consentGiven = true,
                    ),
                    navController,
                )
                else -> LaunchedEffect(Unit) {
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            }
        }

        composable(Routes.PROFILE) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            val vm: ProfileViewModel = viewModel(
                factory = simpleFactory { ProfileViewModel(app.examRepository, app.authRepository, app.apiService) },
            )
            ProfileScreen(
                viewModel = vm,
                session = currentSession,
                onBack = { navController.popBackStack() },
                onSignedOut = { navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } } },
                onAccountDeleted = { navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } } },
            )
        }

        composable(Routes.DASHBOARD) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            val vm: DashboardViewModel = viewModel(factory = simpleFactory { DashboardViewModel(app.examRepository) })
            DashboardScreen(
                viewModel = vm,
                email = currentSession.email,
                onBack = { navController.popBackStack() },
                onOpenAttemptHistory = { navController.navigate(Routes.ATTEMPT_HISTORY) },
            )
        }

        composable(Routes.MISTAKES) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            MistakesFlow(
                examRepository = app.examRepository,
                email = currentSession.email,
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.REMINDERS) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            val vm: RemindersViewModel = viewModel(factory = simpleFactory { RemindersViewModel(app.examRepository) })
            RemindersScreen(
                viewModel = vm,
                session = currentSession,
                onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
            )
        }

        composable(Routes.NOTIFICATIONS) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            val vm: NotificationsViewModel = viewModel(factory = simpleFactory { NotificationsViewModel(app.examRepository) })
            NotificationsScreen(viewModel = vm, email = currentSession.email)
        }

        composable(Routes.ATTEMPT_HISTORY) {
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)
            val currentSession = session ?: return@composable
            val vm: AttemptHistoryViewModel = viewModel(factory = simpleFactory { AttemptHistoryViewModel(app.examRepository) })
            AttemptHistoryScreen(viewModel = vm, email = currentSession.email)
        }

        composable(Routes.EXAM_FLOW) { backStackEntry ->
            val subjectId = backStackEntry.arguments?.getString("subjectId").orEmpty()
            val subjectName = Uri.decode(backStackEntry.arguments?.getString("subjectName").orEmpty())
            val session by app.sessionManager.sessionFlow.collectAsState(initial = null)

            val vm: ExamViewModel = viewModel(
                viewModelStoreOwner = backStackEntry,
                factory = simpleFactory { ExamViewModel(app.examRepository, app.connectivityObserver) },
            )

            val currentSession = session
            if (currentSession == null) {
                // Waiting one recomposition for the DataStore session to
                // load — normally resolves within a frame or two.
                return@composable
            }

            LaunchedEffect(subjectId) { vm.start(currentSession, subjectId, subjectName) }

            val state by vm.uiState.collectAsState()
            when (state.phase) {
                ExamPhase.RESULT -> state.result?.let { result ->
                    ResultScreen(
                        result = result,
                        onBackToHome = {
                            navController.navigate(Routes.HOME) { popUpTo(Routes.HOME) { inclusive = true } }
                        },
                    )
                }
                ExamPhase.LOCKED -> LockedScreen(
                    unlockAtIso = state.lockedUntil,
                    onBack = { navController.popBackStack(Routes.HOME, inclusive = false) },
                )
                else -> ExamScreen(
                    viewModel = vm,
                    onLocked = { /* no-op: the LOCKED branch above already renders on the next recomposition */ },
                    onFinished = { /* no-op: the RESULT branch above already renders on the next recomposition */ },
                )
            }
        }
    }
}

@Composable
private fun HomeRoute(app: MockTestApplication, session: UserSession, navController: NavHostController) {
    val vm: HomeViewModel = viewModel(factory = simpleFactory { HomeViewModel(app.examRepository, app.authRepository) })
    HomeScreen(
        viewModel = vm,
        session = session,
        onOpenSubject = { subject -> navController.navigate(Routes.examFlow(subject.id, subject.name)) },
        onOpenProfile = { navController.navigate(Routes.PROFILE) },
        onOpenDashboard = { navController.navigate(Routes.DASHBOARD) },
        onOpenMistakes = { navController.navigate(Routes.MISTAKES) },
        onOpenReminders = { navController.navigate(Routes.REMINDERS) },
    )
}

private fun openWebsitePage(navController: NavHostController, page: String) {
    val url = BuildConfig.WEBSITE_BASE_URL.trimEnd('/') + "/" + page
    navController.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
}

/** Manual ViewModel factory helper — avoids pulling in Hilt for a handful of call sites. */
private fun <T : ViewModel> simpleFactory(creator: () -> T): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <U : ViewModel> create(modelClass: Class<U>): U = creator() as U
    }
