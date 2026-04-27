// Enhanced Exposure Control System
// Professional-grade auto exposure with hysteresis, smoothing, scene detection, and histogram

class ExposureController {
  constructor() {
    this.filteredBrightness = 128;
    this.cooldown = 0;
    this.history = [];
    this.brightnessHistory = [];
    this.ALPHA = 0.3; // Smoothing factor
    this.COOLDOWN_FRAMES = 3; // Frames to wait between adjustments
    this.DEADBAND = 12; // Deadzone to prevent hunting
    this.isActive = false;
    this.currentEV = 0;
    this.exposureBias = 0; // User exposure bias (-2 to +2)
    this.lastAdjustmentTime = 0;
    this.adjustmentInterval = 500; // Minimum ms between adjustments
  }
  
  setActive(active) {
    this.isActive = active;
    if (!active) {
      this.cooldown = 0;
    }
  }
  
  setExposureBias(bias) {
    this.exposureBias = bias;
  }
  
  async update(video, track) {
    if (!track || !this.isActive) return;
    
    // Check cooldown timer
    const now = Date.now();
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    if (now - this.lastAdjustmentTime < this.adjustmentInterval) {
      return;
    }
    
    // Get weighted brightness (center-weighted for better subject exposure)
    const rawBrightness = this.getWeightedAverageBrightness(video);
    
    // Apply exponential smoothing
    this.filteredBrightness = this.ALPHA * rawBrightness + 
                              (1 - this.ALPHA) * this.filteredBrightness;
    
    // Store history for scene analysis
    this.history.push(this.filteredBrightness);
    if (this.history.length > 20) this.history.shift();
    
    // Get dynamic targets based on scene analysis
    const targets = this.getAdaptiveTargets();
    const capabilities = track.getCapabilities();
    
    if (!capabilities.exposureCompensation) {
      document.getElementById("brightness-info").innerHTML = "⚠️ Not supported";
      return;
    }
    
    const { min, max, step } = capabilities.exposureCompensation;
    let needsAdjustment = false;
    let newEV = this.currentEV;
    
    // Apply exposure bias to targets
    const biasedMin = targets.min + (this.exposureBias * 15);
    const biasedMax = targets.max + (this.exposureBias * 15);
    
    // Check if adjustment is needed (with deadband)
    if (this.filteredBrightness > biasedMax + this.DEADBAND && this.currentEV > min) {
      newEV = Math.max(min, this.currentEV - step);
      needsAdjustment = true;
    } else if (this.filteredBrightness < biasedMin - this.DEADBAND && this.currentEV < max) {
      newEV = Math.min(max, this.currentEV + step);
      needsAdjustment = true;
    }
    
    // Apply adjustment if needed
    if (needsAdjustment && Math.abs(newEV - this.currentEV) > 0.01) {
      try {
        await track.applyConstraints({
          advanced: [{ exposureCompensation: newEV }]
        });
        this.currentEV = newEV;
        this.cooldown = this.COOLDOWN_FRAMES;
        this.lastAdjustmentTime = now;
      } catch (e) {
        console.warn("Failed to adjust exposure:", e);
      }
    }
    
    // Draw histogram for visual feedback
    this.drawHistogram(video);
    
    // Update UI with exposure info
    this.updateDisplay(rawBrightness);
  }
  
  getWeightedAverageBrightness(video) {
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
    const maxDist = Math.sqrt(40*40 + 40*40);
    
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        const dx = (x - centerX) / 40;
        const dy = (y - centerY) / 40;
        const distance = Math.sqrt(dx*dx + dy*dy);
        // Gaussian-like weight - center gets higher weight
        const weight = Math.exp(-distance * distance * 2.5);
        
        const idx = (y * 80 + x) * 4;
        const brightness = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        
        weightedSum += brightness * weight;
        totalWeight += weight;
      }
    }
    
    return weightedSum / totalWeight;
  }
  
  getAdaptiveTargets() {
    // Default targets
    let min = 95;
    let max = 155;
    
    if (this.history.length < 10) {
      return { min, max };
    }
    
    // Calculate variance to detect challenging scenes
    const avg = this.history.reduce((a,b) => a+b, 0) / this.history.length;
    const variance = this.history.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / this.history.length;
    
    // Detect scene type based on brightness distribution
    const recentBrightness = this.history.slice(-5);
    const trend = recentBrightness[recentBrightness.length - 1] - recentBrightness[0];
    const isChanging = Math.abs(trend) > 15;
    
    if (variance > 800) {
      // High contrast scene - wider tolerance
      min = 80;
      max = 170;
    } else if (isChanging) {
      // Scene is changing rapidly - be more responsive
      min = 90;
      max = 160;
      this.ALPHA = 0.5; // Faster response
    } else {
      // Normal scene
      this.ALPHA = 0.3;
    }
    
    return { min, max };
  }
  
  drawHistogram(video) {
    const canvas = document.getElementById('histogram-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 80;
    
    if (video.videoWidth === 0) return;
    
    // Sample video frame
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = 100;
    tempCanvas.height = 100;
    tempCtx.drawImage(video, 0, 0, 100, 100);
    
    const imageData = tempCtx.getImageData(0, 0, 100, 100);
    const data = imageData.data;
    
    // Build histogram (256 bins)
    const histogram = new Array(256).fill(0);
    let maxCount = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const brightness = Math.floor(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
      histogram[brightness]++;
      if (histogram[brightness] > maxCount) {
        maxCount = histogram[brightness];
      }
    }
    
    // Clear canvas
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, 200, 80);
    
    // Draw histogram bars
    const barWidth = 200 / 256;
    for (let i = 0; i < 256; i++) {
      const barHeight = (histogram[i] / maxCount) * 70;
      ctx.fillStyle = `rgb(${i}, ${i}, ${i})`;
      ctx.fillRect(i * barWidth, 80 - barHeight, Math.max(barWidth - 0.5, 1), barHeight);
    }
    
    // Draw target range indicator
    const targets = this.getAdaptiveTargets();
    const biasedMin = targets.min + (this.exposureBias * 15);
    const biasedMax = targets.max + (this.exposureBias * 15);
    
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(biasedMin * barWidth, 0, (biasedMax - biasedMin) * barWidth, 80);
    
    // Draw current brightness line
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1.5;
    const currentX = this.filteredBrightness * barWidth;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, 80);
    ctx.stroke();
  }
  
  updateDisplay(rawBrightness) {
    const infoDiv = document.getElementById("brightness-info");
    const targets = this.getAdaptiveTargets();
    const status = this.isActive ? "🟢 AUTO" : "⚪ MANUAL";
    
    infoDiv.innerHTML = `
      ${status}<br>
      📊 ${Math.round(this.filteredBrightness)}/${Math.round(rawBrightness)}<br>
      🎯 ${Math.round(targets.min + this.exposureBias * 15)}-${Math.round(targets.max + this.exposureBias * 15)}<br>
      ⚡ EV: ${this.currentEV.toFixed(2)}<br>
      ${this.exposureBias > 0 ? '🔆' : (this.exposureBias < 0 ? '🌙' : '⚖️')} Bias: ${this.exposureBias.toFixed(2)}
    `;
  }
  
  getCurrentEV() {
    return this.currentEV;
  }
}

// Global variables
let track = null;
let exposureController = null;
let autoAdjustInterval = null;

// Initialize on page load
window.onload = function() {
  exposureController = new ExposureController();
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
    
    // Initialize exposure controller with current settings
    const capabilities = track.getCapabilities();
    if (capabilities.exposureCompensation) {
      const settings = track.getSettings();
      exposureController.currentEV = settings.exposureCompensation || 0;
    }
    
    status.innerText = "✅ Camera ready";
    
    // Start exposure adjustment loop (60fps)
    function exposureLoop() {
      exposureController.update(document.getElementById("video"), track);
      requestAnimationFrame(exposureLoop);
    }
    exposureLoop();
    
  } catch (error) {
    console.error(error);
    status.innerText = "❌ Error: " + error.message;
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById("video");
        video.srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
        status.innerText = "📷 Using default camera";
        
        function exposureLoop() {
          exposureController.update(document.getElementById("video"), track);
          requestAnimationFrame(exposureLoop);
        }
        exposureLoop();
      } catch (e) {
        status.innerText = "❌ Failed to turn on camera";
      }
    }
  }
}

function registerEvents() {
  const container = document.getElementById("container");
  const toggleBtn = document.getElementById("toggle-exposure-btn");
  const biasSlider = document.getElementById("exposure-bias");
  const biasValue = document.getElementById("bias-value");
  const resetBias = document.getElementById("reset-bias");

  // Auto exposure toggle button
  toggleBtn.addEventListener("click", function() {
    const isActive = exposureController.isActive;
    exposureController.setActive(!isActive);
    
    if (!isActive) {
      this.innerText = "🔆 Auto Exposure: ON";
      this.style.backgroundColor = "#2ecc71";
    } else {
      this.innerText = "🔆 Auto Exposure: OFF";
      this.style.backgroundColor = "#7f8c8d";
    }
  });
  
  // Exposure bias slider
  biasSlider.addEventListener("input", function(e) {
    const bias = parseFloat(e.target.value);
    exposureController.setExposureBias(bias);
    biasValue.innerText = bias.toFixed(2);
  });
  
  // Reset bias button
  resetBias.addEventListener("click", function() {
    biasSlider.value = "0";
    exposureController.setExposureBias(0);
    biasValue.innerText = "0.00";
  });
  
  // Manual focus on click
  container.addEventListener("click", function(e) {
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const video = document.getElementById("video");
    const videoRect = video.getBoundingClientRect();
    
    // Calculate relative coordinates within video element
    const relativeX = (clickX - videoRect.left) / videoRect.width;
    const relativeY = (clickY - videoRect.top) / videoRect.height;
    
    if (relativeX >= 0 && relativeX <= 1 && relativeY >= 0 && relativeY <= 1) {
      applyManualFocus(relativeX, relativeY);
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
    
    // Add exposure info watermark
    const info = exposureController.isActive ? "AUTO" : "MANUAL";
    const ev = exposureController.getCurrentEV().toFixed(2);
    context.font = "20px Arial";
    context.fillStyle = "white";
    context.shadowColor = "black";
    context.shadowBlur = 4;
    context.fillText(`${info} EV:${ev}`, 20, 50);
    context.shadowBlur = 0;
    
    const imageData = hiddenCanvas.toDataURL("image/jpeg", 0.95);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0,19).replace(/:/g, '-');
    link.href = imageData;
    link.download = `photo_${timestamp}.jpg`;
    link.click();
    
    const status = document.getElementById("status");
    const originalText = status.innerText;
    status.innerText = "💾 Photo saved!";
    setTimeout(() => { status.innerText = originalText; }, 2000);
  }
}

async function applyManualFocus(x, y) {
  if (!track) return;
  
  const video = document.getElementById("video");
  const canvas = document.getElementById("focus-canvas");
  const ctx = canvas.getContext('2d');
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  // Draw focus indicator
  const boxSize = 80;
  const centerX = video.videoWidth * x;
  const centerY = video.videoHeight * y;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#00ffcc";
  ctx.lineWidth = 4;
  ctx.shadowBlur = 0;
  ctx.strokeRect(centerX - boxSize/2, centerY - boxSize/2, boxSize, boxSize);
  
  // Draw crosshair
  ctx.beginPath();
  ctx.moveTo(centerX - 15, centerY);
  ctx.lineTo(centerX - 5, centerY);
  ctx.moveTo(centerX + 5, centerY);
  ctx.lineTo(centerX + 15, centerY);
  ctx.moveTo(centerX, centerY - 15);
  ctx.lineTo(centerX, centerY - 5);
  ctx.moveTo(centerX, centerY + 5);
  ctx.lineTo(centerX, centerY + 15);
  ctx.stroke();
  
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
  
  // Clear focus indicator after 2 seconds
  setTimeout(() => { 
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 2000);
}