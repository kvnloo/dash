package app.dash.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression test for PatternSyntaxException crash on Android 15 (S25, 2026-11-01).
 *
 * Root cause: `Regex("[\\p{Cntrl}]")` compiles to Java pattern `[\p{Cntrl}]`. On Android 15
 * (ICU 74 / Samsung One UI 7) the POSIX named class `\p{Cntrl}` inside a character class `[…]`
 * is rejected at pattern index 3 (`{`) with:
 *
 *     java.util.regex.PatternSyntaxException: Syntax error in regexp pattern near index 3
 *
 * Fix: use an explicit hex range `[\x00-\x1F\x7F]` which covers the same ASCII control character
 * set (U+0000–U+001F + DEL U+007F) and is universally supported on all Android versions.
 */
class BoundedCopyTest {
  // Regression: must not throw PatternSyntaxException on any Android version.
  @Test fun safeNameDoesNotThrow() {
    safeName("hello\u0000world.txt")
    safeName("report\u001freport.pdf")
    safeName("\u007Fhidden.apk")
  }

  @Test fun safeNameStripsControlCharacters() {
    assertEquals("hello_world.txt", safeName("hello\u0000world.txt"))
    assertEquals("tab_file.csv",    safeName("tab\u0009file.csv"))
    assertEquals("del_file",        safeName("\u007Fdel_file"))
  }

  @Test fun safeNameStripsPathTraversal() {
    assertEquals("secret.txt", safeName("../../secret.txt"))
    assertEquals("secret.txt", safeName("C:\\folder\\secret.txt"))
  }

  @Test fun safeNameFallsBackOnEmpty() {
    assertEquals("shared-file", safeName(""))
  }

  @Test fun safeNameTruncatesLongNames() {
    assertTrue(safeName("x".repeat(300)).length <= 240)
  }
}
