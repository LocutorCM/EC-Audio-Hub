package com.ecaudio.guitartuner

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.*

private val Bg = Color(0xFF090D13)
private val Panel = Color(0xFF151D28)
private val Mint = Color(0xFF48E6B1)
private val Muted = Color(0xFF8291A3)
private val Strings = listOf(
    GuitarString("E", "E2", 82.41), GuitarString("A", "A2", 110.00),
    GuitarString("D", "D3", 146.83), GuitarString("G", "G3", 196.00),
    GuitarString("B", "B3", 246.94), GuitarString("E", "E4", 329.63)
)
data class GuitarString(val name: String, val note: String, val hz: Double)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { GuitarTunerApp() }
    }
}

@Composable
fun GuitarTunerApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var permission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission = it }
    var selected by remember { mutableIntStateOf(0) }
    var hz by remember { mutableDoubleStateOf(0.0) }
    var cents by remember { mutableDoubleStateOf(0.0) }
    var listening by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf("GUITAR") }
    var calibration by remember { mutableFloatStateOf(440f) }

    LaunchedEffect(permission, listening, selected, mode, calibration) {
        if (!permission || !listening) return@LaunchedEffect
        launch(Dispatchers.IO) {
            val sampleRate = 44100
            val minBuffer = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuffer <= 0) return@launch
            val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, max(minBuffer, 8192))
            try {
                recorder.startRecording()
                val buffer = ShortArray(4096)
                while (isActive && listening) {
                    val count = recorder.read(buffer, 0, buffer.size)
                    if (count > 1024) {
                        val detected = PitchDetector.detect(buffer, count, sampleRate)
                        if (detected > 55.0 && detected < 500.0) {
                            val target = if (mode == "GUITAR") Strings[selected].hz else {
                                val midi = (69.0 + 12.0 * ln(detected / calibration) / ln(2.0)).roundToInt()
                                calibration * 2.0.pow((midi - 69) / 12.0)
                            }
                            val delta = 1200.0 * ln(detected / target) / ln(2.0)
                            withContext(Dispatchers.Main) {
                                hz = detected
                                cents = delta.coerceIn(-50.0, 50.0)
                            }
                        }
                    }
                }
            } catch (_: Exception) {
            } finally {
                try { recorder.stop() } catch (_: Exception) {}
                recorder.release()
            }
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(background = Bg, surface = Panel, primary = Mint)) {
        Column(Modifier.fillMaxSize().background(Bg).padding(horizontal = 22.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("EC AUDIO", color = Mint, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
                    Text("GUITAR TUNER", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.border(1.dp, Color(0xFF2B3948), RoundedCornerShape(20.dp)).padding(horizontal = 12.dp, vertical = 7.dp)) {
                    Text("ELECTRIC • 6 STRING", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(20.dp))
            Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(18.dp)).padding(5.dp)) {
                listOf("GUITAR", "CHROMATIC").forEach { item ->
                    Box(Modifier.weight(1f).background(if (mode == item) Color(0xFF263A3C) else Color.Transparent, RoundedCornerShape(14.dp))
                        .clickable { mode = item }.padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                        Text(item, color = if (mode == item) Mint else Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(17.dp))
            if (mode == "GUITAR") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Strings.forEachIndexed { index, string ->
                        val active = selected == index
                        Column(Modifier.weight(1f).background(if (active) Color(0xFF203A38) else Panel, RoundedCornerShape(12.dp))
                            .border(1.dp, if (active) Mint.copy(alpha = .7f) else Color.Transparent, RoundedCornerShape(12.dp))
                            .clickable { selected = index }.padding(vertical = 12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(string.name, color = if (active) Mint else Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                            Text(string.note, color = Muted, fontSize = 9.sp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Column(Modifier.fillMaxWidth().weight(1f).background(Panel, RoundedCornerShape(24.dp)).padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(if (listening) "ESCUCHANDO TU GUITARRA" else "AFINADOR DE PRECISIÓN",
                    color = Muted, fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(15.dp))
                Text(if (hz > 0) noteName(hz) else if (mode == "GUITAR") Strings[selected].note else "—",
                    color = Color.White, fontSize = 54.sp, fontWeight = FontWeight.Black)
                Text(if (hz > 0) String.format("%.2f Hz", hz) else "Toca una cuerda", color = Muted, fontSize = 14.sp)
                Spacer(Modifier.height(22.dp))
                TuningMeter(cents.toFloat(), hz > 0)
                Spacer(Modifier.height(12.dp))
                Text(when {
                    hz <= 0 -> "ESPERANDO SEÑAL"
                    abs(cents) <= 5 -> "¡AFINADO!"
                    cents < 0 -> "DEMASIADO BAJO  •  SUBE"
                    else -> "DEMASIADO ALTO  •  BAJA"
                }, color = if (hz > 0 && abs(cents) <= 5) Mint else Color(0xFFE9B96B),
                    fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(18.dp))
                Button(onClick = {
                    if (!permission) launcher.launch(Manifest.permission.RECORD_AUDIO) else listening = !listening
                }, colors = ButtonDefaults.buttonColors(containerColor = if (listening) Color(0xFF293744) else Mint),
                    modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(16.dp)) {
                    Text(if (listening) "DETENER AFINADOR" else if (!permission) "PERMITIR MICRÓFONO" else "COMENZAR A AFINAR",
                        color = if (listening) Color.White else Color(0xFF06120F), fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("CALIBRACIÓN", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Text("A4 = ${calibration.toInt()} Hz", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { calibration = (calibration - 1).coerceAtLeast(430f) }) { Text("−", color = Mint, fontSize = 22.sp) }
                    TextButton(onClick = { calibration = (calibration + 1).coerceAtMost(450f) }) { Text("+", color = Mint, fontSize = 22.sp) }
                }
            }
            Text("Coloca el teléfono cerca del amplificador o conecta una interfaz compatible.", color = Muted, fontSize = 10.sp)
        }
    }
}

@Composable
fun TuningMeter(cents: Float, active: Boolean) {
    Canvas(Modifier.fillMaxWidth().height(112.dp)) {
        val center = Offset(size.width / 2f, size.height - 5f)
        val radius = size.width * .39f
        for (i in -5..5) {
            val angle = Math.toRadians(i * 9.0 - 90.0)
            val inner = radius - if (i == 0) 17f else 11f
            drawLine(Color(0xFF526273),
                Offset(center.x + cos(angle).toFloat() * inner, center.y + sin(angle).toFloat() * inner),
                Offset(center.x + cos(angle).toFloat() * radius, center.y + sin(angle).toFloat() * radius),
                strokeWidth = if (i == 0) 4f else 2f, cap = StrokeCap.Round)
        }
        val angle = Math.toRadians(-90.0 + cents.coerceIn(-50f, 50f) * 1.8)
        val tip = Offset(center.x + cos(angle).toFloat() * radius * .83f, center.y + sin(angle).toFloat() * radius * .83f)
        drawLine(if (active && abs(cents) <= 5) Mint else Color(0xFFFFC36A), center, tip, strokeWidth = 5f, cap = StrokeCap.Round)
        drawCircle(Mint, 7f, center)
    }
}

private fun noteName(freq: Double): String {
    val names = listOf("C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B")
    val midi = (69 + 12 * ln(freq / 440.0) / ln(2.0)).roundToInt()
    return names[Math.floorMod(midi, 12)] + (midi / 12 - 1)
}

private object PitchDetector {
    fun detect(input: ShortArray, size: Int, sampleRate: Int): Double {
        val n = min(size, 4096)
        val x = DoubleArray(n) { input[it].toDouble() / 32768.0 }
        val mean = x.average()
        for (i in x.indices) {
            val window = 0.5 - 0.5 * cos(2.0 * PI * i / (n - 1))
            x[i] = (x[i] - mean) * window
        }
        val minLag = sampleRate / 450
        val maxLag = min(sampleRate / 60, n / 2)
        var bestLag = -1
        var best = 0.0
        for (lag in minLag..maxLag) {
            var sum = 0.0
            for (i in 0 until n - lag) sum += x[i] * x[i + lag]
            if (sum > best) { best = sum; bestLag = lag }
        }
        if (bestLag <= 0 || best < 0.01) return 0.0
        val left = if (bestLag > minLag) correlation(x, bestLag - 1) else best
        val middle = correlation(x, bestLag)
        val right = if (bestLag < maxLag) correlation(x, bestLag + 1) else best
        val denominator = left - 2 * middle + right
        val shift = if (abs(denominator) > 1e-12) 0.5 * (left - right) / denominator else 0.0
        return sampleRate / (bestLag + shift).coerceAtLeast(1.0)
    }
    private fun correlation(x: DoubleArray, lag: Int): Double {
        var sum = 0.0
        for (i in 0 until x.size - lag) sum += x[i] * x[i + lag]
        return sum
    }
}
