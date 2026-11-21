package xyz.app566512.apidemo;

import android.content.ContentResolver;
import android.content.res.AssetFileDescriptor;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exposes a short WAV to the WebView using a token for a video chosen by the system picker. */
final class VideoAudio {
    static final String PATH_PREFIX = "/__android_video_audio__/";
    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_SAMPLES = 60 * SAMPLE_RATE;
    private static final long DECODE_TIMEOUT_MS = 12000;
    private static final long CODEC_WAIT_US = 5000;

    private final Map<String, Selection> selections = new ConcurrentHashMap<>();
    private final Map<String, Request> requests = new ConcurrentHashMap<>();

    private static final class Selection {
        volatile Uri uri;
    }

    private static final class Request {
        final String selectionId;
        final Uri uri;
        final CancellationSignal cancellation = new CancellationSignal();
        final AtomicBoolean started = new AtomicBoolean();

        Request(String selectionId, Uri uri) {
            this.selectionId = selectionId;
            this.uri = uri;
        }
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9-]{1,64}");
    }

    boolean reserveSelection(String id) {
        return validId(id) && selections.putIfAbsent(id, new Selection()) == null;
    }

    void acceptSelection(String id, Uri uri) {
        if (id == null) {
            return;
        }
        if (uri == null || !"content".equals(uri.getScheme())) {
            releaseSelection(id);
            return;
        }
        Selection selection = selections.get(id);
        if (selection != null) {
            selection.uri = uri;
        }
    }

    void releaseSelection(String id) {
        if (id != null) {
            selections.remove(id);
            requests.forEach((key, request) -> {
                if (id.equals(request.selectionId)) {
                    cancelRequest(key);
                }
            });
        }
    }

    boolean reserveRequest(String selectionId, String requestId) {
        if (!validId(selectionId) || !validId(requestId)) {
            return false;
        }
        Selection selection = selections.get(selectionId);
        Uri uri = selection == null ? null : selection.uri;
        return uri != null && requests.putIfAbsent(requestId, new Request(selectionId, uri)) == null;
    }

    void cancelRequest(String id) {
        Request request = id == null ? null : requests.remove(id);
        if (request != null) {
            request.cancellation.cancel();
        }
    }

    void clear() {
        for (String id : requests.keySet()) {
            cancelRequest(id);
        }
        selections.clear();
    }

    // shouldInterceptRequest runs outside the UI thread. The WAV is served once and never cached.
    WebResourceResponse serve(ContentResolver resolver, String id) {
        Request request = requests.get(id);
        if (request == null || !request.started.compareAndSet(false, true)) {
            return response(404, "Not Found", null);
        }
        try {
            byte[] wav = readAudio(resolver, request.uri, request.cancellation);
            request.cancellation.throwIfCanceled();
            return wav == null ? response(204, "No Content", null) : response(200, "OK", wav);
        } catch (OperationCanceledException e) {
            return response(410, "Cancelled", null);
        } catch (IOException | RuntimeException e) {
            Log.w("VideoAudio", "Could not decode selected audio (" + e.getClass().getSimpleName() + ")");
            return response(422, "Audio Decode Failed", null);
        } finally {
            requests.remove(id, request);
        }
    }

    private static WebResourceResponse response(int status, String reason, byte[] wav) {
        return new WebResourceResponse(
                "audio/wav", null, status, reason,
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(wav == null ? new byte[0] : wav));
    }

    private static byte[] readAudio(ContentResolver resolver, Uri uri, CancellationSignal signal)
            throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        try {
            try (AssetFileDescriptor file = resolver.openAssetFileDescriptor(uri, "r", signal)) {
                if (file == null) {
                    throw new IOException("Could not open selected video");
                }
                extractor.setDataSource(file);
            }
            for (int index = 0; index < extractor.getTrackCount(); index++) {
                signal.throwIfCanceled();
                MediaFormat format = extractor.getTrackFormat(index);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    extractor.selectTrack(index);
                    return decode(extractor, mime, format, signal);
                }
            }
            return null;
        } finally {
            extractor.release();
        }
    }

    private static byte[] decode(MediaExtractor extractor, String mime, MediaFormat format,
            CancellationSignal signal) throws IOException {
        MediaCodec codec = MediaCodec.createDecoderByType(mime);
        try {
            codec.configure(format, null, null, 0);
            codec.start();
            long deadline = SystemClock.elapsedRealtime() + DECODE_TIMEOUT_MS;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            Wave wave = null;
            boolean inputEnded = false;
            boolean outputEnded = false;
            while (!outputEnded && (wave == null || !wave.isFull())) {
                signal.throwIfCanceled();
                if (SystemClock.elapsedRealtime() >= deadline) {
                    throw new IOException("Audio decoding timed out");
                }
                if (!inputEnded) {
                    int index = codec.dequeueInputBuffer(CODEC_WAIT_US);
                    if (index >= 0) {
                        ByteBuffer input = codec.getInputBuffer(index);
                        if (input == null) {
                            throw new IOException("Missing audio input buffer");
                        }
                        int size = extractor.readSampleData(input, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            codec.queueInputBuffer(index, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                int index = codec.dequeueOutputBuffer(info, CODEC_WAIT_US);
                if (index < 0) {
                    continue;
                }
                try {
                    if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        if (wave == null) {
                            wave = new Wave(codec.getOutputFormat(index));
                        }
                        ByteBuffer output = codec.getOutputBuffer(index);
                        if (output == null) {
                            throw new IOException("Missing PCM output buffer");
                        }
                        output.limit(info.offset + info.size).position(info.offset);
                        wave.append(output.order(ByteOrder.nativeOrder()));
                    }
                } finally {
                    codec.releaseOutputBuffer(index, false);
                }
                outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            }
            return wave == null ? null : wave.toBytes();
        } finally {
            codec.release();
        }
    }

    /** Mixes interleaved PCM to mono and averages each interval of the new sample rate. */
    private static final class Wave {
        private final int inputRate;
        private final int channels;
        private final boolean floatPcm;
        private final short[] samples = new short[MAX_SAMPLES];
        private int length;
        private int interval;
        private double sum;
        private boolean audible;

        Wave(MediaFormat format) throws IOException {
            inputRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding = format.containsKey(MediaFormat.KEY_PCM_ENCODING)
                    ? format.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    : AudioFormat.ENCODING_PCM_16BIT;
            floatPcm = encoding == AudioFormat.ENCODING_PCM_FLOAT;
            if (inputRate <= 0 || channels <= 0 || channels > 32
                    || (!floatPcm && encoding != AudioFormat.ENCODING_PCM_16BIT)) {
                throw new IOException("Unsupported PCM format");
            }
        }

        boolean isFull() {
            return length == samples.length;
        }

        void append(ByteBuffer pcm) throws IOException {
            int bytesPerFrame = channels * (floatPcm ? Float.BYTES : Short.BYTES);
            if (pcm.remaining() % bytesPerFrame != 0) {
                throw new IOException("Incomplete PCM frame");
            }
            while (pcm.hasRemaining() && !isFull()) {
                double mono = 0;
                for (int channel = 0; channel < channels; channel++) {
                    mono += floatPcm ? pcm.getFloat() * 32768 : pcm.getShort();
                }
                mono /= channels;
                // Carry a fractional interval across buffers so resampling preserves duration.
                for (int remaining = SAMPLE_RATE; remaining > 0 && !isFull(); ) {
                    int weight = Math.min(remaining, inputRate - interval);
                    sum += mono * weight;
                    interval += weight;
                    remaining -= weight;
                    if (interval == inputRate) {
                        writeSample();
                    }
                }
            }
        }

        private void writeSample() {
            short sample = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, Math.round(sum / interval)));
            samples[length++] = sample;
            audible |= sample != 0;
            interval = 0;
            sum = 0;
        }

        byte[] toBytes() {
            if (interval > 0 && !isFull()) {
                writeSample();
            }
            if (!audible) {
                return null;
            }
            int dataBytes = length * Short.BYTES;
            ByteBuffer wav = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN);
            wav.put(new byte[]{'R', 'I', 'F', 'F'}).putInt(36 + dataBytes);
            wav.put(new byte[]{'W', 'A', 'V', 'E', 'f', 'm', 't', ' '}).putInt(16);
            wav.putShort((short) 1).putShort((short) 1); // PCM, mono
            wav.putInt(SAMPLE_RATE).putInt(SAMPLE_RATE * Short.BYTES);
            wav.putShort((short) Short.BYTES).putShort((short) 16);
            wav.put(new byte[]{'d', 'a', 't', 'a'}).putInt(dataBytes);
            for (int i = 0; i < length; i++) {
                wav.putShort(samples[i]);
            }
            return wav.array();
        }
    }
}
