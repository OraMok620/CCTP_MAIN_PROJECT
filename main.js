let track = null;

// 當網頁載入完成後執行
window.onload = function() {
  startCamera();
  registerEvents();
};

// 啟動相機
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
  } catch (error) {
    console.error(error);
    status.innerText = "錯誤: " + error.message;
    
    // 如果強制後置鏡頭失敗，嘗試一般模式
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        document.getElementById("video").srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
        status.innerText = "使用預設相機";
      } catch (e) {
        status.innerText = "無法開啟相機";
      }
    }
  }
}

// 註冊事件監聽器
function registerEvents() {
  const container = document.getElementById("container");
  
  // 點擊容器進行對焦
  container.addEventListener("click", function(e) {
    const { offsetX, offsetY } = calculateOffset();
    const x = (e.offsetX - offsetX) / (container.offsetWidth - offsetX * 2);
    const y = (e.offsetY - offsetY) / (container.offsetHeight - offsetY * 2);
    
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      applyManualFocus(x, y);
    }
  });

  // 影相按鈕點擊
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
    
    // 繪製畫面
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // 轉為圖片並下載
    const imageData = hiddenCanvas.toDataURL("image/jpeg", 0.9);
    const link = document.createElement("a");
    const timestamp = new Date().getTime();
    link.href = imageData;
    link.download = `IMG_${timestamp}.jpg`;
    link.click();
    
    // 狀態提示
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
  const ctx = canvas.getContext("2d");

  // 畫出對焦框
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 6;
  ctx.strokeRect(video.videoWidth * x - 40, video.videoHeight * y - 40, 80, 80);

  try {
    // 檢查瀏覽器是否支援 focusMode
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

  // 1.5秒後清除對焦框
  setTimeout(() => { canvas.width = canvas.width; }, 1500);
}

// 計算影片在容器中的偏移量（處理 object-fit: contain）
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