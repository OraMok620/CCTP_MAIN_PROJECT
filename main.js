let track = null;
let currentEV = 0; 
let isAutoExposureActive = false; // 新增：控制自動曝光開關

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
    status.innerText = "相機已啟動";

    setInterval(autoAdjustExposure, 1000);

  } catch (error) {
    console.error(error);
    status.innerText = "錯誤: " + error.message;
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById("video");
        video.srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
        status.innerText = "使用預設相機";
        setInterval(autoAdjustExposure, 1000);
      } catch (e) {
        status.innerText = "無法開啟相機";
      }
    }
  }
}

function getAverageBrightness(video) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 100;
  canvas.height = 100;
  if (video.videoWidth === 0) return 128;
  ctx.drawImage(video, 0, 0, 100, 100);
  const imageData = ctx.getImageData(0, 0, 100, 100);
  const data = imageData.data;
  let brightnessSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    brightnessSum += (0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
  }
  return brightnessSum / (canvas.width * canvas.height);
}

async function autoAdjustExposure() {
  // 如果開關沒打開，或者 track 還沒準備好，就不執行調整
  if (!track || !isAutoExposureActive) return;

  const capabilities = track.getCapabilities();
  if (!capabilities.exposureCompensation) {
    document.getElementById("brightness-info").innerText = "硬體不支援手動曝光";
    return;
  }

  const brightness = getAverageBrightness(document.getElementById("video"));
  const { min, max, step } = capabilities.exposureCompensation;
  const targetMin = 100;
  const targetMax = 160;

  let changed = false;
  if (brightness > targetMax && currentEV > min) {
    currentEV = Math.max(min, currentEV - step);
    changed = true;
  } else if (brightness < targetMin && currentEV < max) {
    currentEV = Math.min(max, currentEV + step);
    changed = true;
  }

  if (changed) {
    try {
      await track.applyConstraints({
        advanced: [{ exposureCompensation: currentEV }]
      });
    } catch (e) {
      console.warn("曝光調整失敗:", e);
    }
  }

  document.getElementById("brightness-info").innerText = 
    `亮度: ${Math.round(brightness)} | EV: ${currentEV.toFixed(1)}`;
}

function registerEvents() {
  const container = document.getElementById("container");
  const toggleBtn = document.getElementById("toggle-exposure-btn");

  // 自動曝光切換按鈕邏輯
  toggleBtn.addEventListener("click", function() {
    isAutoExposureActive = !isAutoExposureActive;
    if (isAutoExposureActive) {
      this.innerText = "自動曝光: ON";
      this.style.backgroundColor = "#2ecc71"; // 變成綠色
    } else {
      this.innerText = "自動曝光: OFF";
      this.style.backgroundColor = "#7f8c8d"; // 變回灰色
    }
  });
  
  container.addEventListener("click", function(e) {
    const { offsetX, offsetY } = calculateOffset();
    const x = (e.offsetX - offsetX) / (container.offsetWidth - offsetX * 2);
    const y = (e.offsetY - offsetY) / (container.offsetHeight - offsetY * 2);
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      applyManualFocus(x, y);
    }
  });

  document.getElementById("capture-btn").addEventListener("click", takePhoto);
}

async function takePhoto() {
  const video = document.getElementById("video");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const context = hiddenCanvas.getContext("2d");
  if (video.videoWidth > 0) {
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
    const imageData = hiddenCanvas.toDataURL("image/jpeg", 0.9);
    const link = document.createElement("a");
    const timestamp = new Date().getTime();
    link.href = imageData;
    link.download = `IMG_${timestamp}.jpg`;
    link.click();
    const status = document.getElementById("status");
    status.innerText = "✅ 已儲存！";
    setTimeout(() => { status.innerText = "相機運作中"; }, 2000);
  }
}

async function applyManualFocus(x, y) {
  if (!track) return;
  const video = document.getElementById("video");
  const canvas = document.getElementById("focus-canvas");
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 6;
  ctx.strokeRect(video.videoWidth * x - 40, video.videoHeight * y - 40, 80, 80);
  try {
    const capabilities = track.getCapabilities();
    if (capabilities.focusMode) {
      await track.applyConstraints({
        advanced: [{ focusMode: "manual", pointsOfInterest: [{ x: x, y: y }] }]
      });
    }
  } catch (err) {
    console.warn("對焦失敗:", err);
  }
  setTimeout(() => { canvas.width = canvas.width; }, 1500);
}

function calculateOffset() {
  const video = document.getElementById("video");
  let cw = video.offsetWidth, ch = video.offsetHeight;
  let vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
  let cr = cw / ch, vr = vw / vh;
  let ox = 0, oy = 0;
  if (cr > vr) {
    ox = (cw - (ch / vh) * vw) / 2;
  } else {
    oy = (ch - (cw / vw) * vh) / 2;
  }
  return { offsetX: ox, offsetY: oy };
}