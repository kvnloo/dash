package app.dash.share

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

class BoundedCopyTest {
  @Test fun copiesBytesWithoutChangingThem() {
    val bytes = ByteArray(150_000) { (it % 251).toByte() }
    val output = ByteArrayOutputStream()
    assertEquals(bytes.size.toLong(), copyBounded(ByteArrayInputStream(bytes), output, bytes.size.toLong()))
    assertArrayEquals(bytes, output.toByteArray())
  }
  @Test fun stopsUnknownLengthStreamsAtTheBound() {
    var read = 0
    val infinite = object : InputStream() {
      override fun read(): Int { read++; return 1 }
    }
    val output = ByteArrayOutputStream()
    assertThrows(IllegalArgumentException::class.java) { copyBounded(infinite, output, 100) }
    assertEquals(101, read)
    assertTrue(output.size() <= 100)
  }
  @Test fun rejectsEmptyFilesAndSanitizesNames() {
    assertThrows(IllegalArgumentException::class.java) { copyBounded(ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream(), 100) }
    assertEquals("secret.txt", safeName("../../secret.txt"))
    assertEquals("secret.txt", safeName("C:\\folder\\secret.txt"))
    assertEquals("shared-file", safeName(""))
    assertTrue(safeName("x".repeat(300)).length <= 240)
  }
}
