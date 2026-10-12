# Keep data models used by Gson reflection-based (de)serialization —
# without this, R8 can rename fields and silently break JSON parsing of
# every Apps Script response in release builds only (a classic "works in
# debug, breaks in release" bug).
-keep class com.ecet.mocktest.data.model.** { *; }
-keep class com.ecet.mocktest.data.remote.** { *; }

# Retrofit / OkHttp
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes Exceptions

# Firebase Auth
-keep class com.google.firebase.auth.** { *; }

# Room
-keep class * extends androidx.room.RoomDatabase
