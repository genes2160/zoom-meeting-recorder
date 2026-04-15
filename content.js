(() => {
    console.log("=== Interview Recorder Loaded (Safe Version) ===");

    let mediaRecorder = null;
    let mixedStream = null;
    let audioContext = null;
    let chunks = [];
    let mode = null;

    function getSupportedMime(type) {
        const options = type === "video"
            ? ["video/webm;codecs=vp9", "video/webm", "video/mp4"]
            : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

        for (let mime of options) {
            if (MediaRecorder.isTypeSupported(mime)) {
                console.log("Using MIME type:", mime);
                return mime;
            }
        }

        throw new Error("No supported MIME type found in this browser.");
    }

    // === UI PANEL ===
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.bottom = "20px";
    panel.style.right = "20px";
    panel.style.zIndex = "999999";
    panel.style.display = "flex";
    panel.style.gap = "8px";
    panel.style.background = "rgba(0,0,0,0.85)";
    panel.style.padding = "12px";
    panel.style.borderRadius = "12px";
    panel.style.boxShadow = "0 4px 15px rgba(0,0,0,0.4)";
    panel.style.fontFamily = "Arial";

    function createBtn(label, color) {
        const b = document.createElement("button");
        b.innerText = label;
        b.style.padding = "8px 12px";
        b.style.border = "none";
        b.style.borderRadius = "8px";
        b.style.cursor = "pointer";
        b.style.fontSize = "13px";
        b.style.background = color;
        b.style.color = "#fff";
        return b;
    }

    const audioBtn = createBtn("🎙 Audio", "#2980b9");
    const videoBtn = createBtn("🎥 Video", "#27ae60");
    const stopBtn = createBtn("⏹ Stop", "#c0392b");

    panel.appendChild(audioBtn);
    panel.appendChild(videoBtn);
    panel.appendChild(stopBtn);
    document.body.appendChild(panel);

    audioBtn.onclick = () => startRecording("audio");
    videoBtn.onclick = () => startRecording("video");
    stopBtn.onclick = stopRecording;

    async function startRecording(type) {
        if (mediaRecorder) {
            console.warn("Already recording");
            return;
        }

        console.log("=== START:", type, "===");

        try {
            mode = type;

            // 🎙 Get mic
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            console.log("Mic acquired");

            // 🖥 Get tab/screen (ENABLE TAB AUDIO)
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: type === "video",
                audio: true
            });
            console.log("Display stream acquired");

            const systemTrack = displayStream.getAudioTracks()[0];

            if (!systemTrack) {
                throw new Error("No system audio track. Enable 'Share tab audio'.");
            }

            // 🎛 Mix audio
            audioContext = new AudioContext();

            const micSource = audioContext.createMediaStreamSource(micStream);
            const systemSource = audioContext.createMediaStreamSource(
                new MediaStream([systemTrack])
            );

            const destination = audioContext.createMediaStreamDestination();

            micSource.connect(destination);
            systemSource.connect(destination);

            if (type === "audio") {
                console.log("Creating dummy video track for compatibility");

                const canvas = document.createElement("canvas");
                canvas.width = 1;
                canvas.height = 1;

                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, 1, 1);

                const dummyStream = canvas.captureStream(1);
                const dummyVideoTrack = dummyStream.getVideoTracks()[0];

                mixedStream = new MediaStream([
                    dummyVideoTrack,
                    ...destination.stream.getAudioTracks()
                ]);
            } else {
                mixedStream = new MediaStream([
                    ...displayStream.getVideoTracks(),
                    ...destination.stream.getAudioTracks()
                ]);
            }

            const mimeType = getSupportedMime(type);

            mediaRecorder = new MediaRecorder(mixedStream, { mimeType });

            chunks = [];

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                    console.log("Chunk size:", e.data.size);
                }
            };

            mediaRecorder.onstart = () => {
                console.log("Recording started successfully");
            };

            mediaRecorder.onerror = (err) => {
                console.error("Recorder error:", err);
            };

            mediaRecorder.onstop = async() => {
                console.log("=== RECORDING STOPPED ===");

                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                const a = document.createElement("a");
                a.href = url;
                a.download = `interview_${mode}_${Date.now()}.webm`;
                a.click();

                URL.revokeObjectURL(url);
                cleanup();


                try {
                    await chrome.runtime.sendMessage({ type: "STOP_TABCAPTURE" });
                } catch (e) {
                    console.warn("[controller] STOP_TABCAPTURE failed:", e);
                }
            };

            mediaRecorder.start();
        } catch (err) {
            console.error("Start failed:", err);
            cleanup();
        }
    }

    async function stopRecording() {
        console.log("=== STOP REQUESTED ===");

        if (!mediaRecorder) {
            console.warn("Nothing recording");
            return;
        }

        try {
            await chrome.runtime.sendMessage({ type: "STOP_TABCAPTURE" });
        } catch (e) {
            console.warn("[controller] STOP_TABCAPTURE failed:", e);
        }
        if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
    }

    function cleanup() {
        console.log("Cleaning up...");

        if (mixedStream) {
            mixedStream.getTracks().forEach(t => t.stop());
        }

        if (audioContext) {
            audioContext.close();
        }

        mediaRecorder = null;
        mixedStream = null;
        audioContext = null;
        chunks = [];
        mode = null;

        console.log("Cleanup complete");
    }
    chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
        try {
            if (message.type === "OFFSCREEN_RECORDING_STARTED") {
                this.handleOffscreenRecordingStarted();
                sendResponse?.({ success: true });
                return;
            }
            if (message.type === "OFFSCREEN_RECORDING_STOPPED") {
                this.handleOffscreenRecordingStopped();
                sendResponse?.({ success: true });
                return;
            }
        } catch (e) {
            console.warn("[msg] handler error:", e);
        }
        return true;
    });
})();