// Camera and exposure control variables
let track = null;
let currentEV = 0;
let isAutoExposureActive = false;

// Smoothing variables for better exposure control
let filteredBrightness = 128;
let adjustmentCooldown = 0;
let brightnessHistory = [];

// Constants for exposure control
const SMOOTHING_FACTOR = 0.3;
const COOLDOWN_FRAMES = 3;
const DEADBAND = 12;  // Prevents constant small adjustments

// Start camera when page loads
window.onload = function() {
  startCamera();
  registerEvents();
};

// Initialize camera with back camera preference
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
    status.innerText = "Camera is turned on";
    
    // Start auto exposure loop
    startExposureLoop();
    
  } catch (error) {
    console.error(error);
    status.innerText = "Error: " + error.message;
    // Fallback to any available camera
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById("video");
        video.srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
        status.innerText = "Using default camera";
        startExposureLoop();
      } catch (e) {
        status.innerText = "Failed to turn on camera";
      }
    }
  }
}

// Start continuous exposure monitoring using requestAnimationFrame
function startExposureLoop() {
  function exposureLoop() {
    if (track && isAutoExposureActive) {
      adjustExposureSmoothly();
    }
    requestAnimationFrame(exposureLoop);
  }
  exposureLoop();
}

// Calculate brightness with center-weighting (focus on subject)
function getCenterWeightedBrightness(video) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 80;
  canvas.height = 80;
  
  if (video.videoWidth === 0) return 128;
  
  ctx.drawImage(video, 0, 0, 80, 80);
  const imageData = ctx.getImageData(0, 0, 80, 80);
  const data = imageData.data;
  
  let weightedSum = 0;
  let totalWeight = 0;
  const centerX = 40, centerY = 40;
  
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      // Calculate distance from center (normalized)
      const dx = (x - centerX) / 40;
      const dy = (y - centerY) / 40;
      const distance = Math.sqrt(dx*dx + dy*dy);
      // Give more weight to center pixels
      const weight = Math.exp(-distance * distance * 2.5);
      
      const idx = (y * 80 + x) * 4;
      const brightness = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      
      weightedSum += brightness * weight;
      totalWeight += weight;
    }
  }
  
  return weightedSum / totalWeight;
}

// Smart exposure adjustment with smoothing and cooldown
async function adjustExposureSmoothly() {
  // Check cooldown
  if (adjustmentCooldown > 0) {
    adjustmentCooldown--;
    return;
  }
  
  const video = document.getElementById("video");
  const capabilities = track.getCapabilities();
  
  // Check if exposure compensation is supported
  if (!capabilities.exposureCompensation) {
    document.getElementById("brightness-info").innerText = "Not supported";
    return;
  }
  
  // Get current brightness with center-weighting
  const rawBrightness = getCenterWeightedBrightness(video);
  
  // Apply exponential smoothing to reduce noise
  filteredBrightness = SMOOTHING_FACTOR * rawBrightness + 
                       (1 - SMOOTHING_FACTOR) * filteredBrightness;
  
  // Store brightness history for scene analysis
  brightnessHistory.push(filteredBrightness);
  if (brightnessHistory.length > 10) brightnessHistory.shift();
  
  // Get dynamic target range based on scene
  let targetMin = 100;
  let targetMax = 160;
  
  // If scene has high contrast, use wider tolerance
  if (brightnessHistory.length >= 5) {
    const variance = calculateVariance(brightnessHistory);
    if (variance > 500) {
      targetMin = 85;
      targetMax = 175;
    }
  }
  
  const { min, max, step } = capabilities.exposureCompensation;
  let changed = false;
  
  // Apply adjustment with deadband to prevent hunting
  if (filteredBrightness > targetMax + DEADBAND && currentEV > min) {
    currentEV = Math.max(min, currentEV - step);
    changed = true;
  } else if (filteredBrightness < targetMin - DEADBAND && currentEV < max) {
    currentEV = Math.min(max, currentEV + step);
    changed = true;
  }
  
  // Apply the exposure change
  if (changed) {
    try {
      await track.applyConstraints({
        advanced: [{ exposureCompensation: currentEV }]
      });
      adjustmentCooldown = COOLDOWN_FRAMES;
    } catch (e) {
      console.warn("Failed to adjust exposure:", e);
    }
  }
  
  // Update display with brightness and EV only
  document.getElementById("brightness-info").innerText = 
    `Brightness: ${Math.round(filteredBrightness)} | EV: ${currentEV.toFixed(2)}`;
}

// Helper function to calculate variance in brightness history
function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return variance;
}

// Register all button and touch events
function registerEvents() {
  const container = document.getElementById("container");
  const toggleBtn = document.getElementById("toggle-exposure-btn");

  // Auto exposure toggle button
  toggleBtn.addEventListener("click", function() {
    isAutoExposureActive = !isAutoExposureActive;
    if (isAutoExposureActive) {
      this.innerText = "Auto adjustment: ON";
      this.style.backgroundColor = "#2ecc71";
    } else {
      this.innerText = "Auto adjustment: OFF";
      this.style.backgroundColor = "#7f8c8d";
    }
  });
  
  // Manual focus on click
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

// Capture and download photo
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
    status.innerText = "Saved";
    setTimeout(() => { status.innerText = "Camera is running"; }, 2000);
  }
}

// Apply manual focus at clicked position
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
    console.warn("Manual focus failed:", err);
  }
  setTimeout(() => { canvas.width = canvas.width; }, 1500);
}

// Calculate video offset for proper click coordinates
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