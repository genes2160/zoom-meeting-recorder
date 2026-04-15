let recorder = null;
let tabStream = null;
let chunks = [];
let playbackCtx = null;
let currentMeta = null;

function sanitizeFilePart(str = "") {
    return String(str)
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "untitled";
}

function nowIsoSafe() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function getBestMimeType() {
    const candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";
}

async function startTabCapture({ streamId, filenamePrefix, tabTitle, tabUrl, tabId }) {
    if (recorder) {
        console.warn("[offscreen] recorder already active");
        return { ok: true, alreadyRecording: true };
    }

    currentMeta = {
        filenamePrefix: filenamePrefix || "meet-recording",
        tabTitle: sanitizeFilePart(tabTitle || "untitled"),
        tabUrl: tabUrl || "",
        tabId: tabId || null,
        startedAt: Date.now(),
    };

    tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: streamId,
            },
        },
        video: {
            mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: streamId,
            },
        },
    });

    if (!tabStream) {
        throw new Error("tabStream not created");
    }

    console.log("[offscreen] stream tracks:", {
        tabAudioTracks: tabStream.getAudioTracks().length,
        tabVideoTracks: tabStream.getVideoTracks().length,
    });

    // keep tab audio audible to user
    if (tabStream.getAudioTracks().length > 0) {
        playbackCtx = new AudioContext();
        const source = playbackCtx.createMediaStreamSource(
            new MediaStream(tabStream.getAudioTracks())
        );
        source.connect(playbackCtx.destination);
    }

    chunks = [];
    recorder = new MediaRecorder(tabStream, { mimeType: getBestMimeType() });

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = (e) => {
        console.error("[offscreen] recorder error:", e);
    };

    recorder.onstop = async () => {
        try {
            const blob = new Blob(chunks, { type: recorder?.mimeType || "video/webm" });

            if (!blob.size) {
                console.warn("[offscreen] empty blob");
                cleanup();
                return;
            }

            const filename = `${currentMeta.filenamePrefix}-${currentMeta.tabTitle}-video-tabcapture-${nowIsoSafe()}.webm`;

            const reader = new FileReader();
            reader.onloadend = async () => {
                try {
                    await chrome.runtime.sendMessage({
                        type: "FINALIZE_RECORDING",
                        url: reader.result,
                        filename,
                        tabId: currentMeta?.tabId || null,
                        meta: {
                            startedAt: currentMeta?.startedAt || null,
                            endedAt: Date.now(),
                            tabUrl: currentMeta?.tabUrl || "",
                            tabTitle: currentMeta?.tabTitle || "",
                        },
                    });
                } catch (err) {
                    console.error("[offscreen] finalize failed:", err);
                } finally {
                    cleanup();
                }
            };

            reader.readAsDataURL(blob);
        } catch (err) {
            console.error("[offscreen] finalize failed:", err);
            cleanup();
        }
    };

    recorder.start(4000);
    console.log("[offscreen] tab recording started");
    return { ok: true };
}

function stopTabCapture() {
    if (recorder && recorder.state !== "inactive") {
        try {
            recorder.requestData?.();
        } catch { }
        recorder.stop();
        return;
    }

    cleanup();
}

function cleanup() {
    try {
        tabStream?.getTracks().forEach((t) => t.stop());
    } catch { }

    try {
        playbackCtx?.close?.();
    } catch { }

    recorder = null;
    tabStream = null;
    playbackCtx = null;
    chunks = [];
    currentMeta = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen") return;

    (async () => {
        if (message.type === "tabcapture-start") {
            const result = await startTabCapture(message.data);
            sendResponse?.(result || { ok: true });
            return;
        }

        if (message.type === "tabcapture-stop") {
            stopTabCapture();
            sendResponse?.({ ok: true });
            return;
        }
    })().catch((e) => {
        console.error("[offscreen] message handler failed:", e);
        sendResponse?.({ ok: false, error: String(e) });
    });

    return true;
});