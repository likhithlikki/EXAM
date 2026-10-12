package com.ecet.mocktest.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = Coral,
    onPrimary = Paper,
    secondary = Amber,
    onSecondary = Ink,
    background = Cream,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    error = DangerRed,
)

private val DarkColors = darkColorScheme(
    primary = Amber,
    onPrimary = Ink,
    secondary = Coral,
    onSecondary = Paper,
    background = Plum,
    onBackground = Cream,
    surface = PlumSoft,
    onSurface = Cream,
    error = DangerRed,
)

/**
 * Dynamic color (Material You) is intentionally OFF by default. This is an
 * exam app with meaning tied to specific brand colors (correct=green,
 * wrong=red, warning states) — letting the wallpaper repaint those would
 * risk exactly the kind of low-contrast color pairing the web app's a11y
 * audit already had to fix once (see legal.css / style.css comments in the
 * web project). Pass useDynamicColor = true only if you deliberately want
 * to revisit that trade-off.
 */
@Composable
fun MockTestTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    useDynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = when {
        useDynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        androidx.compose.runtime.SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MockTestTypography,
        content = content,
    )
}
