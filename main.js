let track = null;

window.onload = function() {
  startCamera();
  registerEvents();
};

async function startCamera() {
  const status = document.getElementById("status");
  const constraints = {
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: { exact: "environment" }
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById("video");
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    status.innerText = "Camera Active";
  } catch (error) {
    status.innerText = "Error: " + error.message;
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        document.getElementById("video").srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
    }
  }
}

function registerEvents() {
  // 點擊畫面對焦
  const container = document.getElementById("container");
  container.addEventListener("click", function(e) {
        const { offsetX, offsetY } = calculateOffset();
        const x = (e.offsetX - offsetX) / (container.offsetWidth - offsetX * 2);
        const y = (e.offsetY - offsetY) / (container.offsetHeight - offsetY * 2);
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) applyManualFocus(x, y);
      });

  // 影相按鈕點擊
  document.getElementById("capture-btn").addEventListener("click", takePhoto);
}

async function takePhoto() {
  const video = document.getElementById("video");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const context = hiddenCanvas.getContext("2d");

  if (video.videoWidth > 0) {
    // 1. 設定隱藏 Canvas 大小與影片原始解像度一致
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;

    // 2. 將影片畫面畫到 Canvas 上
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // 3. 轉換為圖片 Data URL (JPEG 格式)
    const imageData = hiddenCanvas.toDataURL("image/jpeg", 0.9);

    // 4. 自動觸發下載/儲存
    const link = document.createElement("a");
    const timestamp = new Date().getTime();
    link.href = imageData;
    link.download = `photo_${timestamp}.jpg`; // 檔名
    link.click();
    
    // 簡單提示
    const status = document.getElementById("status");
    status.innerText = "已儲存相片！";
    setTimeout(() => { status.innerText = "Camera Active"; }, 2000);
  }
}

// --- 以下保持原有的對焦邏輯 ---
async function applyManualFocus(x, y) {
  if (!track) return;
  const video = document.getElementById("video");
  const canvas = document.getElementById("focus-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 6;
  ctx.strokeRect(video.videoWidth * x - 40, video.videoHeight * y - 40, 80, 80);

  try {
    await track.applyConstraints({
      advanced: [{ focusMode: "manual", pointsOfInterest: [{ x: x, y: y }] }]
    });
  } catch (err) { console.error(err); }
  setTimeout(() => { canvas.width = canvas.width; }, 1500);
}

function calculateOffset() {
  const video = document.getElementById("video");
  let cw = video.offsetWidth, ch = video.offsetHeight;
  let vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
  let cr = cw / ch, vr = vw / vh;
  let ox = 0, oy = 0;
  if (cr > vr) ox = (cw - (ch / vh) * vw) / 2;
  else oy = (ch - (cw / vw) * vh) / 2;
  return { offsetX: ox, offsetY: oy };
}