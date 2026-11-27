package com.ecaudio.guitartuner

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.hardware.camera2.CaptureRequest
import android.os.Bundle
import android.provider.MediaStore
import android.util.Range
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.*
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.common.util.concurrent.ListenableFuture
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private val BG = Color(0xFF080A0D)
private val PANEL = Color(0xE8151A20)
private val GREEN = Color(0xFFB8F36B)
private val FG = Color(0xFFF4F5F6)
private val MUTED = Color(0xFF9AA3AD)
private val RED = Color(0xFFFF4545)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.BLACK
        window.navigationBarColor = android.graphics.Color.BLACK
        setContent { CameraApp() }
    }
}

@Composable
private fun CameraApp() {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    var cameraGranted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var audioGranted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        cameraGranted = result[Manifest.permission.CAMERA] == true || ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        audioGranted = result[Manifest.permission.RECORD_AUDIO] == true || ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER; implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var still by remember { mutableStateOf<ImageCapture?>(null) }
    var video by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var activeRecording by remember { mutableStateOf<Recording?>(null) }
    var recording by remember { mutableStateOf(false) }
    var seconds by remember { mutableLongStateOf(0L) }
    var front by remember { mutableStateOf(false) }
    var resolution by remember { mutableStateOf("4K") }
    var fps by remember { mutableIntStateOf(30) }
    var iso by remember { mutableIntStateOf(400) }
    var shutter by remember { mutableStateOf("1/50") }
    var wb by remember { mutableStateOf("AUTO") }
    var ev by remember { mutableIntStateOf(0) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var grid by remember { mutableStateOf(true) }
    var ready by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }

    DisposableEffect(Unit) {
        onDispose {
            try { activeRecording?.stop() } catch (_: Exception) {}
            provider?.unbindAll()
            executor.shutdown()
        }
    }

    LaunchedEffect(cameraGranted, front, resolution, fps) {
        if (!cameraGranted) return@LaunchedEffect
        try {
            val future: ListenableFuture<ProcessCameraProvider> = ProcessCameraProvider.getInstance(context)
            val cameraProvider = suspendCancellableCoroutine<ProcessCameraProvider> { continuation ->
                future.addListener({
                    try { continuation.resume(future.get()) } catch (error: Throwable) { continuation.resumeWithException(error) }
                }, ContextCompat.getMainExecutor(context))
            }
            provider = cameraProvider
            cameraProvider.unbindAll()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val photo = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build()
            val q = when (resolution) { "4K" -> Quality.UHD; "HD" -> Quality.HD; else -> Quality.FHD }
            val recorder = Recorder.Builder().setQualitySelector(QualitySelector.from(q, FallbackStrategy.lowerQualityOrHigherThan(Quality.FHD))).build()
            val clip = VideoCapture.Builder(recorder).setTargetFrameRate(Range(fps, fps)).build()
            val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
            val bound = cameraProvider.bindToLifecycle(owner, selector, preview, photo, clip)
            camera = bound
            still = photo
            video = clip
            bound.cameraControl.setZoomRatio(zoom)
            bound.cameraControl.setExposureCompensationIndex(ev)
            setManualExposure(bound, iso, shutter)
            setWhiteBalance(bound, wb)
            ready = true
        } catch (_: Exception) {
            ready = false
            message = "Este modo no está disponible en el dispositivo."
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(background = BG, surface = PANEL, primary = GREEN, onPrimary = BG, onSurface = FG)) {
        Box(Modifier.fillMaxSize().background(BG)) {
            if (cameraGranted) {
                AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                if (grid) Grid(Modifier.fillMaxSize())
                // Tap the preview to request autofocus and metering.
                Box(Modifier.fillMaxSize().clickable {
                    val point = previewView.meteringPointFactory.createPoint(previewView.width / 2f, previewView.height / 2f)
                    camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point).build())
                })
                Column(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxWidth().background(Color(0xD9080A0D)).padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column {
                                Text("EC AUDIO", color = GREEN, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
                                Text("BLACKMAGIC CAMERA", color = FG, fontSize = 16.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                            }
                            Spacer(Modifier.weight(1f))
                            Text(if (recording) String.format(Locale.US, "● %02d:%02d", seconds / 60, seconds % 60) else "STANDBY",
                                color = if (recording) RED else GREEN, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(12.dp))
                            Text("⚙", color = FG, fontSize = 22.sp, modifier = Modifier.clickable { settings = true })
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Hud("FPS", fps.toString()); Hud("RES", resolution); Hud("ISO", iso.toString()); Hud("SHUTTER", shutter); Hud("WB", wb)
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Column(Modifier.fillMaxWidth().background(Color(0xE8080A0D)).padding(12.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Param("ISO", iso.toString()) { dialog = "ISO" }
                            Param("SHUTTER", shutter) { dialog = "SHUTTER" }
                            Param("WB", wb) { dialog = "WB" }
                            Param("EV", if (ev >= 0) "+$ev" else ev.toString()) {
                                ev = if (ev >= 2) -2 else ev + 1
                                camera?.cameraControl?.setExposureCompensationIndex(ev)
                            }
                            Param("GRID", if (grid) "ON" else "OFF") { grid = !grid }
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("ZOOM", color = MUTED, fontSize = 9.sp)
                            listOf(1f, 2f, 3f).forEach { z ->
                                Text(z.toInt().toString() + "×", color = if (zoom == z) GREEN else FG,
                                    modifier = Modifier.clickable { zoom = z; camera?.cameraControl?.setZoomRatio(z) }.padding(horizontal = 12.dp, vertical = 5.dp),
                                    fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.weight(1f))
                            Text("TOCA PARA ENFOCAR", color = MUTED, fontSize = 8.sp, letterSpacing = 1.sp)
                        }
                    }
                    Row(Modifier.fillMaxWidth().background(Color(0xF2080A0D)).padding(horizontal = 28.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable {
                            val capture = still ?: return@clickable
                            val name = "EC_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg"
                            val values = ContentValues().apply {
                                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/EC Blackmagic")
                            }
                            val output = ImageCapture.OutputFileOptions.Builder(context.contentResolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values).build()
                            capture.takePicture(output, executor, object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(result: ImageCapture.OutputFileResults) { message = "Fotografía guardada en galería" }
                                override fun onError(error: ImageCaptureException) { message = "No se pudo guardar la fotografía" }
                            })
                        }) {
                            Box(Modifier.size(36.dp).border(2.dp, FG, CircleShape).padding(5.dp).background(FG, CircleShape))
                            Text("FOTO", color = MUTED, fontSize = 8.sp)
                        }
                        Box(Modifier.size(76.dp).border(2.dp, if (recording) RED else FG, CircleShape).padding(7.dp)
                            .background(RED, if (recording) RoundedCornerShape(10.dp) else CircleShape)
                            .clickable {
                                if (recording) {
                                    activeRecording?.stop()
                                    activeRecording = null
                                    recording = false
                                } else {
                                    val capture = video ?: return@clickable
                                    val name = "EC_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".mp4"
                                    val values = ContentValues().apply {
                                        put(MediaStore.Video.Media.DISPLAY_NAME, name)
                                        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                                        put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/EC Blackmagic")
                                    }
                                    val output = MediaStoreOutputOptions.Builder(context.contentResolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI).setContentValues(values).build()
                                    var pending = capture.output.prepareRecording(context, output)
                                    if (audioGranted) pending = pending.withAudioEnabled()
                                    activeRecording = pending.start(ContextCompat.getMainExecutor(context)) { event ->
                                        when (event) {
                                            is VideoRecordEvent.Start -> { recording = true; seconds = 0L }
                                            is VideoRecordEvent.Status -> seconds = event.recordingStats.recordedDurationNanos / 1_000_000_000L
                                            is VideoRecordEvent.Finalize -> {
                                                recording = false
                                                activeRecording = null
                                                message = if (event.hasError()) "Error al guardar el video" else "Video guardado en galería"
                                            }
                                        }
                                    }
                                }
                            })
                        if (recording) Box(Modifier.size(22.dp).background(FG, RoundedCornerShape(4.dp)))
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable { if (!recording) front = !front }) {
                            Text("⇄", color = FG, fontSize = 29.sp)
                            Text(if (front) "FRONTAL" else "CAMBIAR", color = MUTED, fontSize = 8.sp)
                        }
                    }
                    Row(Modifier.fillMaxWidth().background(BG).padding(10.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                        Text("CÁMARA", color = GREEN, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text("MEDIA", color = MUTED, fontSize = 10.sp, modifier = Modifier.clickable { message = "Tus clips están en la galería del teléfono." })
                        Text("AJUSTES", color = MUTED, fontSize = 10.sp, modifier = Modifier.clickable { settings = true })
                    }
                }
                if (!ready) Text("INICIANDO CÁMARA…", color = FG, modifier = Modifier.align(Alignment.Center).background(PANEL, RoundedCornerShape(10.dp)).padding(14.dp))
            } else {
                Column(Modifier.fillMaxSize().background(BG).padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("EC AUDIO", color = GREEN, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp)
                    Text("BLACKMAGIC CAMERA", color = FG, fontSize = 23.sp, fontWeight = FontWeight.Black)
                    Text("Permite el acceso a la cámara y al micrófono para grabar video con sonido.", color = MUTED, fontSize = 13.sp)
                    Spacer(Modifier.height(20.dp))
                    Button(onClick = { permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) },
                        colors = ButtonDefaults.buttonColors(containerColor = GREEN)) { Text("PERMITIR ACCESO", color = BG, fontWeight = FontWeight.Bold) }
                }
            }
            if (message.isNotBlank()) {
                LaunchedEffect(message) { kotlinx.coroutines.delay(2200); message = "" }
                Text(message, color = FG, fontSize = 12.sp, modifier = Modifier.align(Alignment.Center).background(Color(0xE92B3038), RoundedCornerShape(10.dp)).padding(13.dp))
            }
        }
        if (settings) AlertDialog(
            onDismissRequest = { settings = false }, containerColor = Color(0xFF171D24),
            title = { Text("AJUSTES DE CÁMARA", color = GREEN, fontWeight = FontWeight.Bold) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("RESOLUCIÓN", color = MUTED, fontSize = 10.sp)
                Choices(listOf("HD", "FHD", "4K"), resolution) { resolution = it }
                Text("FRECUENCIA DE IMAGEN", color = MUTED, fontSize = 10.sp)
                Choices(listOf("24", "30", "60"), fps.toString()) { fps = it.toInt() }
                Text("Las opciones dependen del sensor y del codificador del teléfono.", color = MUTED, fontSize = 11.sp)
            } },
            confirmButton = { TextButton(onClick = { settings = false }) { Text("LISTO", color = GREEN) } }
        )
        if (dialog.isNotBlank()) {
            val kind = dialog
            val options = when (kind) {
                "ISO" -> listOf("100", "200", "400", "800", "1600", "3200")
                "SHUTTER" -> listOf("1/24", "1/30", "1/48", "1/50", "1/60", "1/100", "1/120", "1/250", "1/500")
                else -> listOf("AUTO", "DAYLIGHT", "CLOUDY", "FLUORESCENT", "INCANDESCENT", "SHADE")
            }
            AlertDialog(onDismissRequest = { dialog = "" }, containerColor = Color(0xFF171D24),
                title = { Text(when (kind) { "ISO" -> "SENSIBILIDAD ISO"; "SHUTTER" -> "OBTURACIÓN"; else -> "BALANCE DE BLANCOS" }, color = GREEN) },
                text = { Column { options.forEach { item ->
                    Text(item, color = FG, modifier = Modifier.fillMaxWidth().clickable {
                        when (kind) { "ISO" -> iso = item.toInt(); "SHUTTER" -> shutter = item; else -> wb = item }
                        camera?.let { if (kind == "WB") setWhiteBalance(it, wb) else setManualExposure(it, iso, shutter) }
                        dialog = ""
                    }.padding(vertical = 9.dp))
                } } },
                confirmButton = { TextButton(onClick = { dialog = "" }) { Text("CERRAR", color = GREEN) } }
            )
        }
    }
}

@Composable
private fun Hud(label: String, value: String) {
    Column { Text(label, color = MUTED, fontSize = 8.sp); Text(value, color = FG, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun Param(label: String, value: String, action: () -> Unit) {
    Column(Modifier.clickable(onClick = action).background(Color(0xFF171D24), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, color = MUTED, fontSize = 8.sp, fontWeight = FontWeight.Bold)
        Text(value, color = GREEN, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Grid(modifier: Modifier) {
    Canvas(modifier) {
        val stroke = 1.dp.toPx()
        for (i in 1..2) {
            val x = size.width * i / 3f
            val y = size.height * i / 3f
            drawLine(Color.White.copy(alpha = .32f), Offset(x, 0f), Offset(x, size.height), strokeWidth = stroke)
            drawLine(Color.White.copy(alpha = .32f), Offset(0f, y), Offset(size.width, y), strokeWidth = stroke)
        }
    }
}

@Composable
private fun Choices(items: List<String>, selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach { item ->
            Box(Modifier.weight(1f).border(1.dp, if (item == selected) GREEN else Color(0xFF3A424B), RoundedCornerShape(8.dp))
                .background(if (item == selected) Color(0xFF293525) else Color.Transparent, RoundedCornerShape(8.dp))
                .clickable { onSelect(item) }.padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text(item, color = if (item == selected) GREEN else FG, fontWeight = FontWeight.Bold, fontSize = 11.sp)
            }
        }
    }
}

private fun setManualExposure(camera: Camera, iso: Int, shutter: String) {
    try {
        val denominator = shutter.substringAfter("/").toLongOrNull() ?: 50L
        val nanos = (1_000_000_000L / denominator).coerceAtLeast(1_000_000L)
        val options = CaptureRequestOptions.Builder()
            .setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
            .setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso)
            .setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, nanos)
            .build()
        Camera2CameraControl.from(camera.cameraControl).setCaptureRequestOptions(options)
    } catch (_: Exception) { }
}

private fun setWhiteBalance(camera: Camera, preset: String) {
    try {
        val mode = when (preset) {
            "DAYLIGHT" -> CaptureRequest.CONTROL_AWB_MODE_DAYLIGHT
            "CLOUDY" -> CaptureRequest.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT
            "FLUORESCENT" -> CaptureRequest.CONTROL_AWB_MODE_FLUORESCENT
            "INCANDESCENT" -> CaptureRequest.CONTROL_AWB_MODE_INCANDESCENT
            "SHADE" -> CaptureRequest.CONTROL_AWB_MODE_SHADE
            else -> CaptureRequest.CONTROL_AWB_MODE_AUTO
        }
        val options = CaptureRequestOptions.Builder().setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, mode).build()
        Camera2CameraControl.from(camera.cameraControl).setCaptureRequestOptions(options)
    } catch (_: Exception) { }
}
