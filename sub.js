//NOTES: START BY SETTING UP GLOBAL VARIABLES AND DECLARING FUNCTIONS.

//Set up global variables
let track = null;// For camera track
let currentEV = 0;// Set up current exposure compensation value
let isAutoExposureActive = false;// Set up button to turn on auto exposure
let filteredBrightness = 128; //Initialize filtered brightness for smoothing
let adjustmentCooldown = 0; //Cooldown counter to prevent rapid adjustments
let brightnessHistory = []; //Store recent brightness values for scene analysis
//Constants for exposure control
const SMOOTHING_FACTOR = 0.3; // Exponential smoothing factor for brightness
const COOLDOWN_FRAMES = 3; // Number of frames to wait after an adjustment before allowing another
const DEADBAND = 12;  // Prevents constant small adjustments

//When the page open, wake up the camera and register event listeners
window.onload = function() {
  startCamera();
  registerEvents();
};

//NOTES : INITIALIZATION AND CAMERA SETUP 

//async enables your program to start a potentially long-running task and still be able to be responsive to other events while that task runs, rather than having to wait until that task has finished. // https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS/Introducing
async function startCamera() {
  const status = document.getElementById("status");//GetElementById() allows to access an element from the HTML document by the ID.
  const constraints = {
    //Setting up the ideal resolutin in 1920*1080
    //There are 2 type of facingMode: user (front camera) and environment (back camera). 
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: { exact: "environment" }
    }
  };

  //Try is the function that will be executed, and catch is the function that will be executed if an error occurs in the try block. // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch
  try {
    //getUserMedia is a web API that allows web applications to access the media devices.
    const stream = await navigator.mediaDevices.getUserMedia(constraints); //constraints is the object that specifies the types of media to request, and any specific requirements for those media types. 
    video.srcObject = stream;
    track = stream.getVideoTracks()[0]; //getVideoTracks() is a method of the MediaStream interface that returns an array of the video tracks in the stream. 
    //Start auto exposure loop
    startExposureLoop(); // Start continuous exposure monitoring using requestAnimationFrame
  } catch (error) {
    //To check console in android device, go to settings ---> developer options ---> enable USB debugging, then connect the device to computer and go to chrome://inspect/#devices in Chrome browser, you will see the device and the opened page, click inspect and you can see the console log there. //https://youtu.be/RSgfFZTBY1Y?si=jZ0jwLyAPbvwyT9-
    console.error(error);
    status.innerText = "Error: " + error.message;
    //If the error is due to constraints, try to access the default camera without constraints as a fallback.
    if (error.name === "OverconstrainedError" || error.name === "NotFoundError") {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById("video");
        video.srcObject = fallbackStream;
        track = fallbackStream.getVideoTracks()[0];
        status.innerText = "Using default camera";
        startExposureLoop();
      } catch (e) {
        status.innerText = "Camera access is failed";
      }
    }
  }
}

// This function continuously monitors the video feed and adjusts exposure smoothly when auto exposure is active. 
// It uses requestAnimationFrame for efficient updates and includes a cooldown mechanism to prevent rapid adjustments.
function startExposureLoop() {
  // Recursive function to continuously check brightness and adjust exposure
  function exposureLoop() {
    //If the track is available and auto exposure is active, call the function to adjust exposure smoothly.
    if (track && isAutoExposureActive) {
      adjustExposureSmoothly();
    }
    //requestAnimationFrame() is a web API method,
    //tells the browser that you wish to perform an animation and requests that the browser calls a specified function to update an animation before the next repaint.
    requestAnimationFrame(exposureLoop); 
  }
  exposureLoop(); //Loop is started by calling the function for the first time.
}

// This function calculates the average brightness of the video feed by drawing a small portion of the video onto a canvas and analyzing the pixel data.
function calculateBrightness(video) {
  //Create a canvas for processing the video frame and get its 2D context for drawing and pixel manipulation.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  //Set the canvas size to 80x80.
  //Smaller canvas size reduces processing load while still providing enough data for brightness calculation, and the center-weighting will help focus on the most relevant area of the frame for exposure adjustment.
  canvas.width = 80; 
  canvas.height = 80;
  // If video hasn't loaded yet, return middle brightness to avoid unnecessary adjustments.
  if (video.videoWidth === 0) return 128;
  //ctx.drawImage() is a method of the CanvasRenderingContext2D interface that draws an image, canvas, or video onto the canvas. 
  ctx.drawImage(video, 0, 0, 80, 80);
  //Get all pixel data from canvas
  const imageData = ctx.getImageData(0, 0, 80, 80);
  const data = imageData.data;//Data is an array: [R,G,B,A, R,G,B,A, ......]
  //Set up variables for calculating weighted average brightness, giving more weight to pixels near the center of the frame.
  let weightedSum = 0;
  let totalWeight = 0;
  const centerX = 40, centerY = 40; //Center of 80x80 image (80/2 = 40)
  //Loop through every pixel.
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      //Calculate distance from center.
      const dx = (x - centerX) / 40;
      const dy = (y - centerY) / 40;
      const distance = Math.sqrt(dx*dx + dy*dy);
      //Give more weight to center pixels
      const weight = Math.exp(-distance * distance * 2.5);
      //Calculate index position in array which each pixel uses 4 values (R,G,B,A).
      const idx = (y * 80 + x) * 4;
      //Calculate brightness using standard luminance formula.
      //Human eyes are most sensitive to G>R>B.
      const brightness = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      //Add weighted brightness to sum and accumulate total weight for normalization.
      weightedSum += brightness * weight;
      totalWeight += weight;
    }
  }
  //Return the weighted average brightness, which will be used for exposure adjustment decisions.
  return weightedSum / totalWeight;
}

//*IMPORTANT PART: EXPOSURE ADJUSTMENT* (Important level: 5 out of 5)

// Smart exposure adjustment with smoothing and cooldown
async function adjustExposureSmoothly() {
  // Check cooldown, if more than 0, decrement and exit for waiting before next adjustment.
  if (adjustmentCooldown > 0) {
    adjustmentCooldown--;
    return;
  }
  const video = document.getElementById("video");
  //*Get video track capabilities, here also important for this project, because we need to check if the camera supports exposure compensation (Following line) before trying to adjust it. 
  const capabilities = track.getCapabilities();
  // Check if exposure compensation is supported
  if (!capabilities.exposureCompensation) {
    document.getElementById("brightness-info").innerText = "Not supported";
    return;
  }
  // Get current brightness with weiighting between 0 to 255.
  const rawBrightness = calculateBrightness(video);
  // Apply exponential smoothing to reduce noise
  filteredBrightness = SMOOTHING_FACTOR * rawBrightness + (1 - SMOOTHING_FACTOR) * filteredBrightness;
  // Store brightness history for scene analysis
  brightnessHistory.push(filteredBrightness); //Add the newest brightness value to the history array, which will be used to analyze recent scene changes and adjust target brightness range dynamically.
  // Keep only the last 10 brightness values to analyze recent scene changes without overloading memory.
  if (brightnessHistory.length > 10) {
    brightnessHistory.shift();//Remove oldest brightness value from the history array to maintain a manageable size while still providing enough data for analysis.
  }
  //Set the range for target brightness.
  let targetMin = 100; //Too dark if lower than 100
  let targetMax = 160; //Vice versa.
  //If scene has high contrast, use wider tolerance
  if (brightnessHistory.length >= 5) { //set at least 5.
    const variance = calculateVariance(brightnessHistory); //Calculate the variance of the brightness history to determine how much the brightness has been changing recently, which can indicate whether the scene is stable or has high contrast.
    if (variance > 500) { //Higher variance higher contrast.
      targetMin = 85;
      targetMax = 175;
    }
  }
  //Notes:
  // "min" = minimum EV value camera supports (usually -2 to -4)
  // "max" = maximum EV value camera supports (usually 2 to 4)
  // "step" = smallest increment camera can adjust (usually 0.166 or 0.333)
  const { min, max, step } = capabilities.exposureCompensation;
  let changed = false; //Flag to track if adjusted exposure.
  //Apply adjustment with deadband to prevent hunting
  //Too bright then make it darker, vice versa, too dark then make it brighter. 
  //However, only if outside of the deadband range to prevent constant small adjustments that can cause flickering.
  //DEADBAND is a threshold value that creates a "dead zone" around the target brightness range, preventing adjustments when the brightness is close enough to the target, which helps to avoid constant small adjustments that can lead to flickering.
  if (filteredBrightness > targetMax + DEADBAND && currentEV > min) {
    currentEV = Math.max(min, currentEV - step);
    changed = true;
  } else if (filteredBrightness < targetMin - DEADBAND && currentEV < max) {
    currentEV = Math.min(max, currentEV + step);
    changed = true;
  }
  // Apply the exposure change to the camera.
  if (changed) {
    try {
      //applyConstraints tells camera to use new exposure value.
      await track.applyConstraints({
        advanced: [{ exposureCompensation: currentEV }]
      });
      adjustmentCooldown = COOLDOWN_FRAMES;
    } catch (e) {
      console.warn("Failed to adjust exposure:", e);
    }
  }
  // Update display with brightness and EV information for debugging and user feedback.
  document.getElementById("brightness-info").innerText = 
    `Brightness: ${Math.round(filteredBrightness)} | EV: ${currentEV.toFixed(2)}`;
}

//Helper function to calculate variance in brightness history.
function calculateVariance(values) {
  //Firstly, calculate the average.
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  //Secondly, calculate the variance.
  const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length;
  return variance;//Higher variance equals more change in scene.
}

//User Interaction and Event Handling
function registerEvents() {
  const container = document.getElementById("container");
  const toggleBtn = document.getElementById("toggle-exposure-btn");
  // Auto exposure toggle button
  toggleBtn.addEventListener("click", function() {
    isAutoExposureActive = !isAutoExposureActive;
    if (isAutoExposureActive) {
      //UI feedback.
      this.innerText = "Adjustment: ON";
      this.style.backgroundColor = "#23b000";
    } else {
      this.innerText = "Adjustment: OFF";
      this.style.backgroundColor = "#595959";
    }
  });
  // Manual focus on click (within video area)
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

//Notes: For function applyManualFocus and function calculateOffset, they work together to allow the user to tap on the video feed to set a focus point.

//Apply manual focus let the web application look like a real camera app, which give better experience to user.
async function applyManualFocus(x, y) {
  if (!track) return;
  const video = document.getElementById("video");
  const canvas = document.getElementById("focus-canvas");
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.strokeStyle = "green";
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

//Capture and download photo
async function takePhoto() {
  const video = document.getElementById("video");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const context = hiddenCanvas.getContext("2d");
  //Ensure video is ready before capturing
  if (video.videoWidth > 0) {
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    //Draw current video frame to canvas and convert to JPEG data URL for downloading.
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
    //toDataURL() is a method of the HTMLCanvasElement interface that returns a data URL containing a representation of the image in the format specified by the type parameter.
    const imageData = hiddenCanvas.toDataURL("image/jpeg", 0.9);
    //Create a temporary link element to trigger the download of the captured image.
    const link = document.createElement("a");
    //Use timestamp in filename to ensure uniqueness and prevent overwriting previous photos.
    const timestamp = new Date().getTime();
    //Set the href of the link to the image data and trigger a click to start the download.
    link.href = imageData;
    link.download = `IMG_${timestamp}.jpg`;
    link.click();
    //Update status to show that the photo has been saved, then revert back to camera status after a short delay for better user feedback.
    const status = document.getElementById("status");
    status.innerText = "Saved";
    setTimeout(() => { status.innerText = "Camera is running"; }, 2000);
  }
}