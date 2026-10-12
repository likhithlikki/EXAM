package com.ecet.mocktest.data.remote

import com.ecet.mocktest.BuildConfig
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonDeserializer
import com.google.gson.JsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object NetworkModule {

    private fun buildGson(): Gson = GsonBuilder()
        .registerTypeAdapter(
            ApiError::class.java,
            JsonDeserializer { json, _, _ ->
                // Code.gs's pre-existing actions (everything except the new
                // auth-gated failures) still return out_({ok:false, error:'a
                // plain string'}) — see friendlyError_ in Code.gs, left
                // deliberately unchanged so the website never breaks. Only
                // the NEW requireAuthenticatedUser_ failures use the
                // structured {code, message} object the Master Prompt asks
                // for. This adapter accepts both without the app crashing
                // on whichever shape a given action happens to return.
                if (json.isJsonPrimitive) {
                    ApiError(code = "SERVER_ERROR", message = json.asString)
                } else {
                    val obj = json.asJsonObject
                    ApiError(
                        code = obj.get("code")?.asString ?: "SERVER_ERROR",
                        message = obj.get("message")?.asString ?: "Something went wrong.",
                    )
                }
            },
        )
        .create()

    private fun buildOkHttp(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            // BODY logging only in debug builds — an ID token or exam
            // answers must never land in a release-build logcat, per the
            // Master Prompt's "Firebase ID token logging" self-check item.
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /**
     * IMPORTANT — verify once building in Android Studio: Retrofit's
     * `@GET(".")`/`@POST(".")` (used throughout ApiService) resolves
     * against this baseUrl to request the exact same /exec URL with no
     * extra path segment. This is a common, working pattern for "one
     * fixed endpoint, only query/body varies" APIs, but since this
     * sandbox cannot run Gradle/an emulator, treat your FIRST successful
     * homeBundle call as the proof this resolves the way intended rather
     * than assuming it from this comment alone.
     */
    fun buildApiService(): ApiService {
        val baseUrl = BuildConfig.APPS_SCRIPT_BASE_URL.let { if (it.endsWith("/")) it else "$it/" }
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(buildOkHttp())
            .addConverterFactory(GsonConverterFactory.create(buildGson()))
            .build()
            .create(ApiService::class.java)
    }
}
