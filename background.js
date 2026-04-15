const OFFSCREEN_PATH = "offscreen.html";

function extractMeetingId(url) {
    const match = url.match(/app\.zoom\.us\/wc\/([a-z0-9\-]+)/i);
    return match ? match[1] : null;
}
async function ensureOffscreen() {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

    if ("getContexts" in chrome.runtime) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [offscreenUrl],
        });

        if (contexts.length > 0) return;
    }

    await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["USER_MEDIA"],
        justification: "Record active tab audio/video with tabCapture",
    });
}

function isMeetRecordingUrl(url = "") {
    try {
        const u = new URL(url);
        return u.hostname === "https://app.zoom.us/";
    } catch {
        return false;
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (!tab?.id) {
            console.warn("[background] no tab id");
            return;
        }

        if (!isMeetRecordingUrl(tab.url)) {
            console.warn("[background] not a valid Meet recording tab:", tab.url);
            return;
        }

        await ensureOffscreen();

        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id,
        });

        const res = await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "tabcapture-start",
            data: {
                streamId,
                tabId: tab.id,
                filenamePrefix: `zoom-meeting-recording-${extractMeetingId(tab.url || "")}`,
                tabTitle: tab.title || "untitled",
                tabUrl: tab.url || "",
            },
        });

        if (!res?.ok) {
            console.error("[background] offscreen start failed:", res);
            return;
        }

        try {
            await chrome.tabs.sendMessage(tab.id, {
                type: "OFFSCREEN_RECORDING_STARTED",
                payload: {
                    mode: "tabcapture",
                    startedAt: Date.now(),
                },
            });
        } catch (e) {
            console.warn("[background] content notify start failed:", e);
        }

        console.log("[background] tabCapture started + content notified");
    } catch (e) {
        console.error("[background] tabCapture start failed:", e);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "FINALIZE_RECORDING") {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: true,
        }).then(async (downloadId) => {
            const tabId = message.tabId || null;

            if (tabId) {
                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: "OFFSCREEN_RECORDING_STOPPED",
                        payload: {
                            downloadId,
                            meta: message.meta || {},
                        },
                    });
                } catch { }
            }

            sendResponse?.({ ok: true, downloadId });
        }).catch((err) => {
            console.error("[background] download failed:", err);
            sendResponse?.({ ok: false, error: String(err) });
        });

        return true;
    }

    if (message?.type === "STOP_TABCAPTURE") {
        const tabId = sender.tab?.id || message.tabId || null;

        chrome.runtime.sendMessage({
            target: "offscreen",
            type: "tabcapture-stop",
        }).then(() => {
            sendResponse?.({ ok: true, stopping: true, tabId });
        }).catch((e) => {
            console.error("[background] stop failed:", e);
            sendResponse?.({ ok: false, error: String(e) });
        });

        return true;
    }

    return false;
});