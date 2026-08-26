// camera.js — mobile-first invoice capture: live camera with a scan frame
// guide, or fallback to the native file/camera picker on devices or browsers
// where getUserMedia isn't available (or permission is denied).
const Camera = (() => {
  let stream = null;

  function icon(name) {
    const icons = {
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    };
    return icons[name] || '';
  }

  async function open({ onCapture, onCancel }) {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-video-wrap">
        <video autoplay playsinline muted></video>
        <div class="scan-frame"></div>
        <div class="camera-hint">Position the invoice inside the frame</div>
      </div>
      <div class="camera-bar">
        <button class="camera-close" data-action="cancel">${icon('close')}</button>
        <button class="shutter-btn" data-action="shutter" aria-label="Capture photo"></button>
        <div class="camera-spacer"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const hint = overlay.querySelector('.camera-hint');

    function cleanup() {
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      overlay.remove();
    }

    overlay.querySelector('[data-action="cancel"]').onclick = () => { cleanup(); onCancel && onCancel(); };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      video.srcObject = stream;
    } catch (err) {
      cleanup();
      // Fall back to the native camera/file picker (works everywhere, incl. desktop).
      openNativePicker({ capture: true, onCapture, onCancel });
      return;
    }

    let lastBrightnessWarnAt = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Lightweight, dependency-free "quality" signal: sample brightness to warn
    // on very dark/underexposed frames. This is a heuristic, not true blur/edge
    // detection — enough to give the mobile-first capture UI useful feedback
    // without pulling in a computer-vision library.
    const qualityInterval = setInterval(() => {
      if (!video.videoWidth) return;
      canvas.width = 60; canvas.height = 60;
      ctx.drawImage(video, 0, 0, 60, 60);
      const data = ctx.getImageData(0, 0, 60, 60).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      const brightness = sum / (data.length / 4);
      const now = Date.now();
      if (brightness < 40 && now - lastBrightnessWarnAt > 1500) {
        hint.textContent = 'Too dark — move to better light';
        hint.classList.add('warn');
        lastBrightnessWarnAt = now;
        setTimeout(() => { hint.textContent = 'Position the invoice inside the frame'; hint.classList.remove('warn'); }, 1500);
      }
    }, 700);

    overlay.querySelector('[data-action="shutter"]').onclick = () => {
      clearInterval(qualityInterval);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        const file = new File([blob], `invoice-${Date.now()}.jpg`, { type: 'image/jpeg' });
        showRetakeConfirm(overlay, video, URL.createObjectURL(blob), {
          onKeep: () => { cleanup(); onCapture(file); },
          onRetake: () => {
            overlay.querySelector('.camera-video-wrap').innerHTML =
              `<video autoplay playsinline muted></video><div class="scan-frame"></div><div class="camera-hint">Position the invoice inside the frame</div>`;
            const newVideo = overlay.querySelector('video');
            newVideo.srcObject = stream;
            overlay.querySelector('.camera-bar').style.display = 'flex';
            overlay.querySelector('.camera-retake-bar')?.remove();
            open._rebind && open._rebind();
          },
        });
      }, 'image/jpeg', 0.92);
    };
  }

  function showRetakeConfirm(overlay, video, previewUrl, { onKeep, onRetake }) {
    const wrap = overlay.querySelector('.camera-video-wrap');
    wrap.innerHTML = `<img class="captured-preview" src="${previewUrl}" alt="Captured invoice preview" />`;
    overlay.querySelector('.camera-bar').style.display = 'none';
    const bar = document.createElement('div');
    bar.className = 'camera-retake-bar';
    bar.innerHTML = `<button class="btn btn-ghost" data-r="retake" style="background:#fff">Retake</button><button class="btn btn-accent" data-r="keep">Use Photo</button>`;
    overlay.appendChild(bar);
    bar.querySelector('[data-r="retake"]').onclick = () => { bar.remove(); onRetake(); };
    bar.querySelector('[data-r="keep"]').onclick = () => onKeep();
  }

  function openNativePicker({ capture, onCapture, onCancel }) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.className = 'file-input-hidden';
    if (capture) input.setAttribute('capture', 'environment');
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (file) onCapture(file); else onCancel && onCancel();
    };
    input.click();
  }

  return { open, openNativePicker };
})();
