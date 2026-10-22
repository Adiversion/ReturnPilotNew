(function() {
  try {
    var screenH = window.screen.availHeight || window.screen.height || 1080;
    var scale = 1.0;
    if (screenH <= 768) {
      scale = 0.88;
    } else if (screenH <= 950) {
      scale = 0.94;
    }

    var w = Math.round(760 * scale);
    var h = Math.round(600 * scale);

    if (typeof __DEV__ === 'undefined' || __DEV__) {
      try {
        var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        window.__rpPopupMetrics = {
          t0: t0,
          screen: {
            availHeight: window.screen ? window.screen.availHeight : null,
            availWidth: window.screen ? window.screen.availWidth : null,
            height: window.screen ? window.screen.height : null,
            width: window.screen ? window.screen.width : null,
            dpr: window.devicePixelRatio || 1
          },
          beforeScale: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            clientWidth: document.documentElement ? document.documentElement.clientWidth : null,
            clientHeight: document.documentElement ? document.documentElement.clientHeight : null
          },
          appliedScale: scale,
          targetWidth: w,
          targetHeight: h,
          resizeEvents: []
        };

        var lastRKey = '';
        window.addEventListener('resize', function () {
          if (window.__rpPopupMetrics) {
            var rKey = window.innerWidth + 'x' + window.innerHeight + '|' + window.outerWidth + 'x' + window.outerHeight;
            if (rKey === lastRKey) return;
            lastRKey = rKey;
            var tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            var evt = {
              tElapsedMs: Math.round((tNow - t0) * 10) / 10,
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              outerWidth: window.outerWidth,
              outerHeight: window.outerHeight,
              clientWidth: document.documentElement ? document.documentElement.clientWidth : null,
              clientHeight: document.documentElement ? document.documentElement.clientHeight : null
            };
            window.__rpPopupMetrics.resizeEvents.push(evt);
            if (typeof rpLog !== 'undefined' && rpLog && typeof rpLog.info === 'function') {
              rpLog.info('POPUP_RESIZE', 'Window resized to ' + window.innerWidth + 'x' + window.innerHeight + ' (+' + evt.tElapsedMs + 'ms)', evt);
            }
          }
        });
      } catch (_) {}
    }

    if (document.documentElement.style.width !== w + 'px') {
      document.documentElement.style.width = w + 'px';
    }
    if (document.documentElement.style.height !== h + 'px') {
      document.documentElement.style.height = h + 'px';
    }

    if (scale !== 1.0 && !document.getElementById('rp-scale-style')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'rp-scale-style';
      styleEl.textContent = 'body { zoom: ' + scale + ' !important; }';
      document.head.appendChild(styleEl);
    }

    if (typeof __DEV__ === 'undefined' || __DEV__) {
      try {
        if (window.__rpPopupMetrics) {
          window.__rpPopupMetrics.afterScale = {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            clientWidth: document.documentElement ? document.documentElement.clientWidth : null,
            clientHeight: document.documentElement ? document.documentElement.clientHeight : null
          };
        }
      } catch (_) {}
    }
  } catch (_) {}
})();

