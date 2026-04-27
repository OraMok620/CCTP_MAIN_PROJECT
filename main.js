let track = null;
let currentEV = 0; // 當前曝光補償值

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

    // 啟動曝光自動檢查循環 (每 1000 毫秒一次)
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

// 核心：分析影像亮度
function getAverageBrightness(video) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // 使用小尺寸抽樣以維持效能
  canvas.width = 100;
  canvas.height = 100;
  
  if (video.videoWidth === 0) return 128; // 預設中間值

  ctx.drawImage(video, 0, 0, 100, 100);
  const imageData = ctx.getImageData(0, 0, 100, 100);
  const data = imageData.data;
  let brightnessSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    // 心理學亮度公式：Y = 0.299R + 0.587G + 0.114B
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];
    brightnessSum += (0.299 * r + 0.587 * g + 0.114 * b);
  }

  return brightnessSum / (canvas.width * canvas.height);
}

// 核心：自動調整曝光補償
async function autoAdjustExposure() {
  if (!track) return;

  const capabilities = track.getCapabilities();
  // 檢查裝置是否支援曝光補償 (Exposure Compensation)
  if (!capabilities.exposureCompensation) {
    document.getElementById("brightness-info").innerText = "硬體不支援手動曝光";
    return;
  }

  const brightness = getAverageBrightness(document.getElementById("video"));
  const { min, max, step } = capabilities.exposureCompensation;
  
  // 設定目標亮度範圍 (0-255)
  const targetMin = 100;
  const targetMax = 160;

  let changed = false;

  if (brightness > targetMax && currentEV > min) {
    currentEV = Math.max(min, currentEV - step); // 太亮，降低曝光
    changed = true;
  } else if (brightness < targetMin && currentEV < max) {
    currentEV = Math.min(max, currentEV + step); // 太暗，提高曝光
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

  // UI 更新顯示數據
  document.getElementById("brightness-info").innerText = 
    `亮度: ${Math.round(brightness)} | EV: ${currentEV.toFixed(1)}`;
}

// 註冊事件監聽器
function registerEvents() {
  const container = document.getElementById("container");
  
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

// 影相並自動儲存
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

// 執行手動對焦
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
        advanced: [{ 
          focusMode: "manual", 
          pointsOfInterest: [{ x: x, y: y }] 
        }]
      });
    }
  } catch (err) {
    console.warn("對焦失敗:", err);
  }
  setTimeout(() => { canvas.width = canvas.width; }, 1500);
}

// 計算偏移
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