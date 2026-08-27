// camera.js — mobile-first invoice capture
// Live camera + scan frame + native picker fallback.

const Camera = (() => {
  let stream = null;
  let qualityInterval = null;

  function icon(name) {
    const icons = {
      close:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M18 6L6 18M6 6l12 12"/>' +
        '</svg>',
    };

    return icons[name] || '';
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('[Camera] Could not stop track:', error);
        }
      });

      stream = null;
    }
  }

  function stopQualityMonitor() {
    if (qualityInterval) {
      clearInterval(qualityInterval);
      qualityInterval = null;
    }
  }

  function cleanup(overlay) {
    stopQualityMonitor();
    stopStream();

    if (overlay) {
      overlay.remove();
    }
  }

  async function open({ onCapture, onCancel } = {}) {
    const existing = document.querySelector('.camera-overlay');

    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');

    overlay.className = 'camera-overlay';

    overlay.innerHTML = `
      <div class="camera-video-wrap">
        <video autoplay playsinline muted></video>

        <div class="scan-frame"></div>

        <div class="camera-hint">
          Position the invoice inside the frame
        </div>
      </div>

      <div class="camera-bar">
        <button
          class="camera-close"
          data-action="cancel"
          type="button"
          aria-label="Close camera"
        >
          ${icon('close')}
        </button>

        <button
          class="shutter-btn"
          data-action="shutter"
          type="button"
          aria-label="Capture photo"
        ></button>

        <div class="camera-spacer"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const video = overlay.querySelector('video');
    const hint = overlay.querySelector('.camera-hint');
    const cameraBar = overlay.querySelector('.camera-bar');
    const cancelButton = overlay.querySelector(
      '[data-action="cancel"]'
    );

    if (!video || !cameraBar || !cancelButton) {
      cleanup(overlay);

      toastCameraError(
        'Camera interface could not be initialized.'
      );

      return;
    }

    cancelButton.onclick = () => {
      cleanup(overlay);

      if (typeof onCancel === 'function') {
        onCancel();
      }
    };

    // Camera API unavailable
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      console.warn(
        '[Camera] getUserMedia unavailable. Using native picker.'
      );

      cleanup(overlay);

      openNativePicker({
        capture: true,
        multiple: false,
        onCapture,
        onCancel,
      });

      return;
    }

    // Open camera
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: 'environment',
          },
          width: {
            ideal: 1920,
          },
          height: {
            ideal: 1920,
          },
        },
        audio: false,
      });

      video.srcObject = stream;

      try {
        await video.play();
      } catch (playError) {
        console.warn(
          '[Camera] Video play failed:',
          playError
        );
      }
    } catch (error) {
      console.warn(
        '[Camera] Unable to access camera:',
        error
      );

      cleanup(overlay);

      openNativePicker({
        capture: true,
        multiple: false,
        onCapture,
        onCancel,
      });

      return;
    }

    // Quality monitoring
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let lastBrightnessWarnAt = 0;

    function startQualityMonitor(targetVideo, targetHint) {
      stopQualityMonitor();

      if (!ctx) {
        return;
      }

      qualityInterval = setInterval(() => {
        if (!targetVideo.videoWidth) {
          return;
        }

        try {
          canvas.width = 60;
          canvas.height = 60;

          ctx.drawImage(
            targetVideo,
            0,
            0,
            60,
            60
          );

          const data = ctx.getImageData(
            0,
            0,
            60,
            60
          ).data;

          let sum = 0;

          for (
            let i = 0;
            i < data.length;
            i += 4
          ) {
            sum +=
              (
                data[i] +
                data[i + 1] +
                data[i + 2]
              ) / 3;
          }

          const brightness =
            sum /
            (data.length / 4);

          const now = Date.now();

          if (
            brightness < 40 &&
            now - lastBrightnessWarnAt > 1500
          ) {
            targetHint.textContent =
              'Too dark — move to better light';

            targetHint.classList.add('warn');

            lastBrightnessWarnAt = now;

            setTimeout(() => {
              if (
                targetHint &&
                targetHint.isConnected
              ) {
                targetHint.textContent =
                  'Position the invoice inside the frame';

                targetHint.classList.remove('warn');
              }
            }, 1500);
          }
        } catch (error) {
          console.warn(
            '[Camera] Quality check failed:',
            error
          );
        }
      }, 700);
    }

    startQualityMonitor(
      video,
      hint
    );

    // Restore camera after retake
    function restoreCameraUI() {
      overlay.innerHTML = `
        <div class="camera-video-wrap">
          <video
            autoplay
            playsinline
            muted
          ></video>

          <div class="scan-frame"></div>

          <div class="camera-hint">
            Position the invoice inside the frame
          </div>
        </div>

        <div class="camera-bar">
          <button
            class="camera-close"
            data-action="cancel"
            type="button"
            aria-label="Close camera"
          >
            ${icon('close')}
          </button>

          <button
            class="shutter-btn"
            data-action="shutter"
            type="button"
            aria-label="Capture photo"
          ></button>

          <div class="camera-spacer"></div>
        </div>
      `;

      const newVideo =
        overlay.querySelector('video');

      const newHint =
        overlay.querySelector('.camera-hint');

      const newCancel =
        overlay.querySelector(
          '[data-action="cancel"]'
        );

      const newShutter =
        overlay.querySelector(
          '[data-action="shutter"]'
        );

      if (!newVideo || !newShutter) {
        cleanup(overlay);
        return;
      }

      newVideo.srcObject = stream;

      newVideo.play().catch(() => {});

      if (newCancel) {
        newCancel.onclick = () => {
          cleanup(overlay);

          if (typeof onCancel === 'function') {
            onCancel();
          }
        };
      }

      newShutter.onclick =
        capturePhoto;

      startQualityMonitor(
        newVideo,
        newHint
      );
    }

    // Capture photo
    function capturePhoto() {
      if (
        !video.videoWidth ||
        !video.videoHeight
      ) {
        toastCameraError(
          'Camera is still starting. Please try again.'
        );

        return;
      }

      stopQualityMonitor();

      const captureCanvas =
        document.createElement('canvas');

      captureCanvas.width =
        video.videoWidth;

      captureCanvas.height =
        video.videoHeight;

      const captureContext =
        captureCanvas.getContext('2d');

      if (!captureContext) {
        toastCameraError(
          'Unable to capture the photo.'
        );

        return;
      }

      captureContext.drawImage(
        video,
        0,
        0,
        captureCanvas.width,
        captureCanvas.height
      );

      captureCanvas.toBlob(
        (blob) => {
          if (!blob) {
            toastCameraError(
              'Unable to create the invoice image.'
            );

            return;
          }

          const previewUrl =
            URL.createObjectURL(blob);

          const file =
            new File(
              [blob],
              `invoice-${Date.now()}.jpg`,
              {
                type: 'image/jpeg',
              }
            );

          showRetakeConfirm(
            overlay,
            previewUrl,
            {
              onKeep: () => {
                URL.revokeObjectURL(
                  previewUrl
                );

                cleanup(overlay);

                if (
                  typeof onCapture ===
                  'function'
                ) {
                  onCapture(file);
                }
              },

              onRetake: () => {
                URL.revokeObjectURL(
                  previewUrl
                );

                restoreCameraUI();
              },
            }
          );
        },
        'image/jpeg',
        0.92
      );
    }

    const shutter =
      overlay.querySelector(
        '[data-action="shutter"]'
      );

    if (shutter) {
      shutter.onclick =
        capturePhoto;
    }
  }

  function showRetakeConfirm(
    overlay,
    previewUrl,
    { onKeep, onRetake }
  ) {
    const wrap =
      overlay.querySelector(
        '.camera-video-wrap'
      );

    const cameraBar =
      overlay.querySelector(
        '.camera-bar'
      );

    if (!wrap || !cameraBar) {
      return;
    }

    wrap.innerHTML = `
      <img
        class="captured-preview"
        src="${previewUrl}"
        alt="Captured invoice preview"
      />

      <div class="camera-hint">
        Check the invoice is clear and readable
      </div>
    `;

    cameraBar.style.display =
      'none';

    const bar =
      document.createElement('div');

    bar.className =
      'camera-retake-bar';

    bar.innerHTML = `
      <button
        class="btn btn-ghost"
        data-r="retake"
        type="button"
        style="background:#fff"
      >
        Retake
      </button>

      <button
        class="btn btn-accent"
        data-r="keep"
        type="button"
      >
        Use Photo
      </button>
    `;

    overlay.appendChild(bar);

    const retakeButton =
      bar.querySelector(
        '[data-r="retake"]'
      );

    const keepButton =
      bar.querySelector(
        '[data-r="keep"]'
      );

    if (retakeButton) {
      retakeButton.onclick = () => {
        bar.remove();

        cameraBar.style.display =
          'flex';

        onRetake();
      };
    }

    if (keepButton) {
      keepButton.onclick = () => {
        keepButton.disabled =
          true;

        keepButton.textContent =
          'Using Photo…';

        onKeep();
      };
    }
  }

  function openNativePicker({
    capture = false,
    multiple = false,
    onCapture,
    onCancel,
  } = {}) {
    const input =
      document.createElement('input');

    input.type =
      'file';

    input.accept =
      'image/*,application/pdf';

    input.className =
      'file-input-hidden';

    if (capture) {
      input.setAttribute(
        'capture',
        'environment'
      );
    }

    if (multiple) {
      input.setAttribute(
        'multiple',
        'multiple'
      );
    }

    document.body.appendChild(input);

    input.onchange = () => {
      const files =
        Array.from(
          input.files || []
        );

      input.remove();

      if (files.length) {
        if (
          typeof onCapture ===
          'function'
        ) {
          onCapture(
            multiple
              ? files
              : files[0]
          );
        }
      } else if (
        typeof onCancel ===
        'function'
      ) {
        onCancel();
      }
    };

    input.oncancel = () => {
      input.remove();

      if (
        typeof onCancel ===
        'function'
      ) {
        onCancel();
      }
    };

    input.click();
  }

  function toastCameraError(message) {
    if (
      typeof window.toast ===
      'function'
    ) {
      window.toast(
        message,
        'error'
      );

      return;
    }

    console.error(
      '[Camera]',
      message
    );
  }

  return {
    open,
    openNativePicker,
  };
})();
