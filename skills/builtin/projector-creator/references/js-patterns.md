# Projector JS Patterns

Ready-to-use JavaScript code blocks for projector tools. Read the target HTML first to know the element IDs, then adapt these patterns.

## How to Use

1. `read_file` the target HTML to see element IDs and structure
2. Copy the patterns below that match the needed features
3. Adapt element IDs to match the HTML
4. Use `edit_file` to replace `// JAVASCRIPT GOES HERE` with the adapted code

## Pattern: File Upload (Drag & Drop + Click)

```javascript
// --- File Upload ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
let imageSrc = null;
let imageWidth = 0, imageHeight = 0;

document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) {
  e.preventDefault();
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
if (dropzone) {
  dropzone.addEventListener('click', function() { fileInput.click(); });
}
fileInput.addEventListener('change', function() {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      imageSrc = e.target.result;
      imageWidth = img.naturalWidth;
      imageHeight = img.naturalHeight;
      if (dropzone) dropzone.style.display = 'none';
      document.getElementById('statusInfo').textContent =
        imageWidth + ' x ' + imageHeight + 'px — ' + file.name;
      onImageLoaded(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
```

## Pattern: Image Display with SVG Unsharp Mask Sharpening

```javascript
// --- SVG Filter Sharpening (GPU-accelerated) ---
// Requires this SVG in the HTML (hidden, before <script>):
// <svg width="0" height="0" style="position:absolute">
//   <defs>
//     <filter id="unsharpMask" color-interpolation-filters="sRGB">
//       <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blurred"/>
//       <feComposite in="SourceGraphic" in2="blurred" operator="arithmetic"
//         k1="0" k2="3" k3="-2" k4="0" result="sharpened"/>
//     </filter>
//   </defs>
// </svg>

var filteredImage = document.getElementById('filteredImage');
var originalImage = document.getElementById('originalImage');
var svgFilter = document.querySelector('#unsharpMask');
var feBlur = svgFilter.querySelector('feGaussianBlur');
var feComposite = svgFilter.querySelector('feComposite');

function onImageLoaded(img) {
  filteredImage.src = imageSrc;
  originalImage.src = imageSrc;
  filteredImage.style.display = 'block';
  updateFilters();
}

function updateFilters() {
  var amount = parseInt(document.getElementById('sharpenAmount').value);
  var radius = parseFloat(document.getElementById('sharpenRadius').value);
  var contrast = parseInt(document.getElementById('contrastSlider').value);
  var brightness = parseInt(document.getElementById('brightnessSlider').value);
  var saturation = parseInt(document.getElementById('saturationSlider').value);

  // Update SVG filter: unsharp mask = original + amount*(original - blurred)
  var amt = amount / 100;
  feBlur.setAttribute('stdDeviation', radius);
  feComposite.setAttribute('k2', (1 + amt).toFixed(2));
  feComposite.setAttribute('k3', (-amt).toFixed(2));

  // CSS filter for contrast/brightness/saturation
  var cssFilter = 'url(#unsharpMask) contrast(' + contrast + '%) brightness(' +
    brightness + '%) saturate(' + saturation + '%)';
  filteredImage.style.filter = cssFilter;
}
```

## Pattern: Slider with Live Value Label

```javascript
// --- Slider Labels ---
function setupSlider(sliderId, labelId, suffix, divisor) {
  var slider = document.getElementById(sliderId);
  var label = document.getElementById(labelId);
  if (!slider || !label) return;
  slider.addEventListener('input', function() {
    var val = divisor ? (parseFloat(slider.value) / divisor).toFixed(1) : slider.value;
    label.textContent = val + (suffix || '');
    updateFilters();
  });
}
// Usage: setupSlider('sharpenAmount', 'amountVal', '%');
// Usage: setupSlider('sharpenRadius', 'radiusVal', 'px', 10);
```

## Pattern: Preset Buttons

```javascript
// --- Presets ---
var presets = {
  light:     { amount: 100, radius: 8,  contrast: 102, brightness: 100, saturation: 105 },
  medium:    { amount: 200, radius: 12, contrast: 105, brightness: 101, saturation: 110 },
  strong:    { amount: 350, radius: 18, contrast: 112, brightness: 100, saturation: 118 },
  wallpaper: { amount: 200, radius: 12, contrast: 108, brightness: 102, saturation: 112 }
};

function applyPreset(name) {
  document.querySelectorAll('.preset-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.querySelector('.preset-btn[data-preset="' + name + '"]');
  if (btn) btn.classList.add('active');
  var p = presets[name];
  if (!p) return;
  document.getElementById('sharpenAmount').value = p.amount;
  document.getElementById('sharpenRadius').value = p.radius;
  document.getElementById('contrastSlider').value = p.contrast;
  document.getElementById('brightnessSlider').value = p.brightness;
  document.getElementById('saturationSlider').value = p.saturation;
  updateFilters();
  // Update all slider labels
  document.querySelectorAll('input[type="range"]').forEach(function(s) {
    s.dispatchEvent(new Event('input'));
  });
}
```

## Pattern: View Toggle (Result / Compare / Original)

```javascript
// --- View Toggle ---
var currentView = 'result';

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-toggle button').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.querySelector('[data-view="' + view + '"]');
  if (btn) btn.classList.add('active');

  filteredImage.style.display = view === 'result' && imageSrc ? 'block' : 'none';
  originalImage.style.display = view === 'original' && imageSrc ? 'block' : 'none';
  var compareContainer = document.getElementById('compareContainer');
  if (compareContainer) {
    compareContainer.style.display = view === 'compare' && imageSrc ? 'block' : 'none';
    if (view === 'compare') updateCompare();
  }
}
```

## Pattern: Compare Slider (Drag to Compare)

```javascript
// --- Compare View ---
var comparePos = 0.5;
var compareContainer = document.getElementById('compareContainer');
var compareClip = document.getElementById('compareClip');
var compareLine = document.getElementById('compareLine');
var isDragging = false;

function updateCompare() {
  if (!compareContainer) return;
  var w = compareContainer.getBoundingClientRect().width;
  var x = w * comparePos;
  compareClip.style.width = x + 'px';
  compareLine.style.left = x + 'px';
}

if (compareLine) {
  compareLine.addEventListener('mousedown', function() { isDragging = true; });
}
if (compareContainer) {
  compareContainer.addEventListener('mousedown', function(e) {
    isDragging = true;
    var rect = compareContainer.getBoundingClientRect();
    comparePos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    updateCompare();
  });
}
document.addEventListener('mousemove', function(e) {
  if (!isDragging || !compareContainer) return;
  var rect = compareContainer.getBoundingClientRect();
  comparePos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  updateCompare();
});
document.addEventListener('mouseup', function() { isDragging = false; });
```

## Pattern: Download (Canvas Render at Full Resolution)

```javascript
// --- Download ---
function downloadImage(mimeType, filename, quality) {
  if (!imageSrc) return;
  document.getElementById('statusInfo').textContent = 'Rendering...';

  var amount = parseInt(document.getElementById('sharpenAmount').value);
  var contrast = parseInt(document.getElementById('contrastSlider').value) / 100;
  var brightness = parseInt(document.getElementById('brightnessSlider').value) / 100;
  var saturation = parseInt(document.getElementById('saturationSlider').value) / 100;
  var amt = Math.min(amount / 100, 4);

  var srcImg = new Image();
  srcImg.onload = function() {
    // Step 1: Sharpen via convolution kernel
    var srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageWidth;
    srcCanvas.height = imageHeight;
    var srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(srcImg, 0, 0);
    var srcData = srcCtx.getImageData(0, 0, imageWidth, imageHeight);
    var sharpened = applySharpenKernel(srcData, amt);
    var outCanvas = document.createElement('canvas');
    outCanvas.width = imageWidth;
    outCanvas.height = imageHeight;
    var outCtx = outCanvas.getContext('2d');
    outCtx.putImageData(sharpened, 0, 0);

    // Step 2: Apply CSS-like filters
    var finalCanvas = document.createElement('canvas');
    finalCanvas.width = imageWidth;
    finalCanvas.height = imageHeight;
    var finalCtx = finalCanvas.getContext('2d');
    finalCtx.filter = 'contrast(' + contrast + ') brightness(' + brightness + ') saturate(' + saturation + ')';
    finalCtx.drawImage(outCanvas, 0, 0);

    // Step 3: Download
    var link = document.createElement('a');
    link.download = filename;
    link.href = quality ? finalCanvas.toDataURL(mimeType, quality) : finalCanvas.toDataURL(mimeType);
    link.click();
    document.getElementById('statusInfo').textContent = 'Download complete.';
  };
  srcImg.src = imageSrc;
}

function applySharpenKernel(imageData, amount) {
  var w = imageData.width, h = imageData.height, data = imageData.data;
  var result = new Uint8ClampedArray(data.length);
  var a = Math.min(amount, 4);
  var kernel = [0, -a, 0, -a, 1+4*a, -a, 0, -a, 0];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var idx = (y * w + x) * 4;
      if (y === 0 || y === h-1 || x === 0 || x === w-1) {
        result[idx]=data[idx]; result[idx+1]=data[idx+1]; result[idx+2]=data[idx+2]; result[idx+3]=data[idx+3];
        continue;
      }
      for (var c = 0; c < 3; c++) {
        var sum =
          kernel[0]*data[((y-1)*w+(x-1))*4+c] + kernel[1]*data[((y-1)*w+x)*4+c] + kernel[2]*data[((y-1)*w+(x+1))*4+c] +
          kernel[3]*data[(y*w+(x-1))*4+c] + kernel[4]*data[(y*w+x)*4+c] + kernel[5]*data[(y*w+(x+1))*4+c] +
          kernel[6]*data[((y+1)*w+(x-1))*4+c] + kernel[7]*data[((y+1)*w+x)*4+c] + kernel[8]*data[((y+1)*w+(x+1))*4+c];
        result[idx+c] = Math.max(0, Math.min(255, Math.round(sum)));
      }
      result[idx+3] = data[idx+3];
    }
  }
  return new ImageData(result, w, h);
}
```

## Pattern: Save to Workspace

```javascript
// --- Save to Workspace ---
function saveToWorkspace(filename, textContent) {
  window.parent.postMessage({
    type: 'projector:save', filename: filename, content: textContent, encoding: 'text'
  }, '*');
}

function saveBinaryToWorkspace(filename, canvas) {
  canvas.toBlob(function(blob) {
    var reader = new FileReader();
    reader.onload = function() {
      window.parent.postMessage({
        type: 'projector:save', filename: filename,
        content: reader.result.split(',')[1], encoding: 'base64'
      }, '*');
    };
    reader.readAsDataURL(blob);
  });
}

window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'projector:save-result') {
    document.getElementById('statusInfo').textContent = event.data.success
      ? 'Saved to workspace: ' + event.data.path
      : 'Save failed: ' + event.data.error;
  }
});
```

## Pattern: Simple Calculator / Converter

```javascript
// --- Calculator ---
function calculate() {
  var input1 = parseFloat(document.getElementById('input1').value) || 0;
  var input2 = parseFloat(document.getElementById('input2').value) || 0;
  var result = input1 * input2; // replace with actual formula
  document.getElementById('resultValue').textContent = result.toFixed(2);
  document.getElementById('statusInfo').textContent = 'Calculated.';
}

function resetForm() {
  document.querySelectorAll('input[type="number"], input[type="text"]').forEach(function(el) {
    el.value = '';
  });
  document.getElementById('resultValue').textContent = '—';
  document.getElementById('statusInfo').textContent = 'Reset.';
}
```

## Rules

1. ALWAYS use `var` instead of `const`/`let` for maximum browser compatibility in iframe sandbox
2. ALWAYS check if element exists before adding listeners: `if (el) { el.addEventListener(...) }`
3. NEVER use `fetch()` or any network calls
4. NEVER leave empty functions or TODO comments
5. After writing JS, read_file the result to verify completeness
