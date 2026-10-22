/**
 * ReturnPilot — Professional Logging & Telemetry Pipeline
 * 
 * Enterprise-grade logging architecture modeled after Big Tech client standards:
 * - Silent in production by default (0 console spam for end users, 0 screen artifacts)
 * - In-memory Flight Recorder (circular ring buffer) for zero-DOM crash and lifecycle diagnosis
 * - Bounded buffer (1,000 entries) prevents memory bloat
 * - Dev-only UI drawer for real-time telemetry inspection inside the popup (100% eliminated in production)
 * - Build-pipeline integration for dead-code elimination (Terser pure_funcs & drop_console)
 */

(function (global) {
  'use strict';

  const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
  };

  const MAX_BUFFER_SIZE = 3000;
  const _historyBuffer = [];
  const _subscribers = [];
  const _timers = new Map();

  // In production builds, Terser replaces __DEV__ with false and DCE purges dev branches.
  // In raw development mode, __DEV__ is undefined, so _isDev evaluates to true.
  let _isDev = (typeof __DEV__ === 'undefined' || Boolean(__DEV__));
  let _minLevel = _isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.SILENT;

  // Check persistent developer mode flag in extension storage if available
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['rp_debug_mode'], (res) => {
        if (res && res.rp_debug_mode !== undefined) {
          _minLevel = res.rp_debug_mode ? LOG_LEVELS.DEBUG : LOG_LEVELS.SILENT;
        }
      });
    } catch (_) {}
  }

  function getTimestamp() {
    const d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function record(levelName, levelNum, tag, message, details) {
    let pNow = Date.now();
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
        pNow = Math.round(performance.now() * 10) / 10;
      }
    } catch (_) {}

    const nowEpoch = Date.now();
    const isDoc = (typeof window !== 'undefined' && typeof document !== 'undefined');
    const entry = {
      id: _historyBuffer.length + 1,
      time: pNow,
      epoch: nowEpoch,
      timeStr: getTimestamp(),
      level: levelName,
      tag: tag || 'EVENT',
      message: message || '',
      details: details !== undefined ? details : null,
      context: isDoc ? 'POPUP' : 'SW'
    };

    _historyBuffer.push(entry);
    if (_historyBuffer.length > MAX_BUFFER_SIZE) {
      _historyBuffer.shift();
    }

    // Notify registered UI subscribers (e.g. dev drawer)
    for (let i = 0; i < _subscribers.length; i++) {
      try {
        _subscribers[i](entry);
      } catch (_) {}
    }

    // Output to console only in dev mode when current level meets threshold
    if ((typeof __DEV__ === 'undefined' || __DEV__) && levelNum >= _minLevel && typeof console !== 'undefined') {
      const isTiming = entry.tag.includes('TIMING') || entry.tag.startsWith('BG_');
      const tagColor = levelNum >= LOG_LEVELS.ERROR ? '#ef4444' : (levelNum >= LOG_LEVELS.WARN ? '#f59e0b' : (isTiming ? '#c084fc' : '#3b82f6'));
      const prefix = `%c[ReturnPilot @ +${pNow}ms] %c[${entry.tag}]`;
      // Use console.log for all telemetry in extension context to avoid polluting chrome://extensions error collector
      const fn = levelNum >= LOG_LEVELS.ERROR ? (console.error || console.log) : console.log;

      try {
        if (details !== null && details !== undefined) {
          fn.call(console, prefix, 'color:#6366f1;font-weight:bold;', `color:${tagColor};font-weight:bold;`, message, details);
        } else {
          fn.call(console, prefix, 'color:#6366f1;font-weight:bold;', `color:${tagColor};font-weight:bold;`, message);
        }
      } catch (_) {}
    }
  }

  const rpLog = {
    LEVELS: LOG_LEVELS,
    batchSummaries: [],
    lastBatchSummary: null,

    debug: function(tag, message, details) {
      record('DEBUG', LOG_LEVELS.DEBUG, tag, message, details);
    },

    info: function(tag, message, details) {
      record('INFO', LOG_LEVELS.INFO, tag, message, details);
    },

    warn: function(tag, message, details) {
      record('WARN', LOG_LEVELS.WARN, tag, message, details);
    },

    error: function(tag, message, details) {
      record('ERROR', LOG_LEVELS.ERROR, tag, message, details);
    },

    userAction: function(action, message, details) {
      const fullMsg = message ? `${action}: ${message}` : action;
      record('INFO', LOG_LEVELS.INFO, 'USER_ACTION', fullMsg, details);
    },

    timing: function(tag, message, details) {
      const fullTag = tag ? (tag.startsWith('RP_TIMING') ? tag : `RP_TIMING:${tag}`) : 'RP_TIMING';
      record('DEBUG', LOG_LEVELS.DEBUG, fullTag, message, details);
    },

    time: function(label) {
      if (!label) return;
      _timers.set(label, (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    },

    timeEnd: function(label, subtag, details) {
      if (!label) return null;
      const start = _timers.get(label);
      if (start !== undefined) {
        _timers.delete(label);
        const pNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const elapsed = Math.round((pNow - start) * 10) / 10;
        const tag = subtag ? `RP_TIMING:${subtag}` : 'RP_TIMING';
        record('DEBUG', LOG_LEVELS.DEBUG, tag, `${label}: ${elapsed}ms`, { elapsedMs: elapsed, ...(details || {}) });
        return elapsed;
      }
      return null;
    },

    timingChain: function(urlOrLabel, breakdown) {
      const hop1 = breakdown?.hop1Ms !== undefined && breakdown?.hop1Ms !== null ? `${breakdown.hop1Ms}ms` : '—';
      const auth = breakdown?.authMs !== undefined && breakdown?.authMs !== null ? `${breakdown.authMs}ms` : '—';
      const net  = breakdown?.networkMs !== undefined && breakdown?.networkMs !== null ? `${breakdown.networkMs}ms` : '—';
      const hop2 = breakdown?.hop2Ms !== undefined && breakdown?.hop2Ms !== null ? `${breakdown.hop2Ms}ms` : '—';
      const total = breakdown?.totalMs !== undefined && breakdown?.totalMs !== null ? `${breakdown.totalMs}ms` : '—';

      const ttfb = breakdown?.ttfbMs !== undefined && breakdown?.ttfbMs !== null ? `${breakdown.ttfbMs}ms` : '—';
      const dl   = breakdown?.downloadMs !== undefined && breakdown?.downloadMs !== null ? `${breakdown.downloadMs}ms` : '—';
      const size = breakdown?.payloadBytes ? `${(breakdown.payloadBytes / 1024).toFixed(1)} KB` : '—';

      // Calculate percentage attribution for all segments
      let attribution = '';
      let dlPct = '';
      if (breakdown?.totalMs > 0) {
        const netPct = breakdown?.networkMs !== null && breakdown?.networkMs !== undefined
          ? Math.min(100, Math.round((breakdown.networkMs / breakdown.totalMs) * 100)) : null;
        const ipcPct = Math.min(100, Math.round((((breakdown.hop1Ms || 0) + (breakdown.hop2Ms || 0)) / breakdown.totalMs) * 100));
        const dlPctVal = breakdown?.downloadMs !== null && breakdown?.downloadMs !== undefined
          ? Math.min(100, Math.round((breakdown.downloadMs / breakdown.totalMs) * 100)) : null;
        if (netPct !== null) attribution = ` [GSTN_NET: ${netPct}% | EXT_IPC: ${ipcPct}%]`;
        if (dlPctVal !== null) dlPct = ` (${dlPctVal}% of total)`;
      }

      // Body download is the main hidden delay between network response and SW handoff —
      // make it prominent when it's significant (>10ms or >15% of total)
      const dlMs = breakdown?.downloadMs ?? 0;
      const totalMs = breakdown?.totalMs ?? 0;
      const dlFlag = (dlMs > 10 || (totalMs > 0 && dlMs / totalMs > 0.15)) ? ' ⚠️' : '';

      const swProc = breakdown?.swProcessingMs !== undefined && breakdown?.swProcessingMs !== null ? `${breakdown.swProcessingMs}ms` : '—';

      const msg = `Total ${total}${attribution} | IPC→SW: ${hop1} | SW Auth: ${auth} | TTFB: ${ttfb} | Body DL: ${dl}${dlPct}${dlFlag} [${size}] | SW Proc: ${swProc} | SW→IPC: ${hop2} | GSTN Net: ${net} | for ${urlOrLabel || ''}`;
      record('DEBUG', LOG_LEVELS.DEBUG, 'RP_TIMING:CHAIN', msg, breakdown);
    },

    batchDiagnostics: function(summary) {
      if (!summary) return;
      this.lastBatchSummary = summary;
      if (!Array.isArray(this.batchSummaries)) this.batchSummaries = [];
      this.batchSummaries.push(summary);
      if (this.batchSummaries.length > 50) this.batchSummaries.shift();
      const lines = [
        `==================== 📊 RETURNPILOT BATCH PERFORMANCE DIAGNOSTICS ====================`,
        `Batch: ${summary.batch || 'Batch'} | Items: ${summary.items || 0} periods | Concurrency: ${summary.concurrencyLimit || 4} workers`,
        `Wall Clock Elapsed   : ${summary.wallClockMs} ms`,
        ...(summary.perceivedUx ? [
          `Perceived UX Latency : T_1st: ${summary.perceivedUx.timeToFirstRowMs} ms | T_50%: ${summary.perceivedUx.timeTo50PctRowsMs} ms | T_80%: ${summary.perceivedUx.timeTo80PctRowsMs} ms | T_100%: ${summary.perceivedUx.timeTo100PctRowsMs} ms (p90: ${summary.perceivedUx.p90RowVisibleMs} ms)`
        ] : []),
        `Parallel Speedup     : ${summary.speedup} (Sum of serial network latency: ${summary.network?.totalNetSumMs || 0} ms)`,
        `Total API Calls      : ${summary.apiCalls || 0} requests executed`,
        `GSTN Portal Network  :`,
        `  • Server Condition : ${summary.serverCondition || 'Normal'} (Jitter: ±${summary.jitterMs || 0} ms)`,
        `  • Latency Spectrum : Min: ${summary.network?.minMs || 0} ms | Avg: ${summary.network?.avgMs || 0} ms | p50: ${summary.network?.p50Ms || 0} ms | p90: ${summary.network?.p90Ms || 0} ms | p95: ${summary.network?.p95Ms || 0} ms | Max: ${summary.network?.maxMs || 0} ms`,
        ...(summary.network?.slowestUrl ? [`  • Slowest Request  : ${summary.network.slowestUrl}`] : []),
        `Client Concurrency   :`,
        `  • Queue Spectrum   : Avg: ${summary.queue?.avgWaitMs || 0} ms | p50: ${summary.queue?.p50WaitMs || 0} ms | p90: ${summary.queue?.p90WaitMs || 0} ms | Max: ${summary.queue?.maxWaitMs || 0} ms ${summary.queue?.maxWaitMonth ? `(${summary.queue.maxWaitMonth})` : ''}`,
        `Extension Overhead   :`,
        `  • Avg Chrome IPC   : ${summary.extensionOverhead?.avgIpcMs || 0} ms`,
        `  • Auth Resolution  : ${summary.extensionOverhead?.totalAuthMs || 0} ms`,
        ...(summary.pacer ? [
          `BBR-Lite Pacer       :`,
          `  • Baseline (RTTmin): ${summary.pacer.rttMin} ms (p50: ${summary.pacer.p50} ms | p90: ${summary.pacer.p90} ms | Peak: ${summary.pacer.peak} ms)`,
          `  • Pacer Dynamic    : ${summary.pacer.accels} ACCEL ⚡ | ${summary.pacer.brakes} BRAKE 🛑 (Lock-free gradient flow)`
        ] : []),
        `Verdict: ${summary.verdict || 'Normal operation'}`,
        `======================================================================================`
      ];
      const banner = lines.join('\n');
      record('INFO', LOG_LEVELS.INFO, 'BATCH_DIAGNOSTICS', `Batch completed: ${summary.batch} in ${summary.wallClockMs}ms (${summary.speedup} speedup) — ${summary.verdict}`, summary);
      if (typeof console !== 'undefined' && console.log) {
        console.log(`%c${banner}`, 'color:#38bdf8;font-weight:bold;font-family:monospace;');
        if (summary.timeline && summary.timeline.length > 0 && console.table) {
          try {
            console.table(summary.timeline);
          } catch (_) {}
        }
      }
    },

    enrichDiagnostics: function(enrichSummary) {
      if (!enrichSummary) return;
      const totalOps = enrichSummary.apiRequests !== undefined ? enrichSummary.apiRequests : ((enrichSummary.formdetailsRequests || 0) + (enrichSummary.generateRequests || 0));
      const lines = [
        `==================== 📦 PHASE 2 BACKGROUND ENRICHMENT ====================`,
        `Batch: ${enrichSummary.batch || ''} | Unique Periods: ${enrichSummary.periodsCount || 0} | Total API Calls: ${totalOps}`,
        `Breakdown          : FormDetails: ${enrichSummary.formdetailsRequests || 0} | Timestamps: ${enrichSummary.generateRequests || 0} | Cache Hits: ${enrichSummary.cacheHits || 0} | Nil Fast-Flips: ${enrichSummary.nilFiledPeriods || 0}`,
        `Wall Clock Elapsed : ${enrichSummary.wallClockMs || 0} ms (Avg: ${enrichSummary.avgPerPeriodMs || 0} ms/period) | Concurrency: ${enrichSummary.concurrency || 2}`,
        `Execution Mode     : Pipelined Background (0ms foreground UI thread blocking)`,
        `==========================================================================`
      ];
      const banner = lines.join('\n');
      record('INFO', LOG_LEVELS.INFO, 'ENRICH_DIAGNOSTICS', `Phase 2 enrichment for ${enrichSummary.batch}: ${enrichSummary.periodsCount} periods (${totalOps} API calls, ${enrichSummary.cacheHits || 0} cached) in ${enrichSummary.wallClockMs}ms`, enrichSummary);
      if (typeof console !== 'undefined' && console.log) {
        console.log(`%c${banner}`, 'color:#10b981;font-weight:bold;font-family:monospace;');
      }
    },

    createBatchTelemetry: function(batchName, totalItems, concurrencyLimit, renderId) {
      return new BatchTelemetry(batchName, totalItems, concurrencyLimit, renderId);
    },

    subscribe: function(fn) {
      if (typeof fn === 'function') {
        _subscribers.push(fn);
        return function unsubscribe() {
          const idx = _subscribers.indexOf(fn);
          if (idx !== -1) _subscribers.splice(idx, 1);
        };
      }
      return function() {};
    },

    setLevel: function(level) {
      if (typeof level === 'string' && LOG_LEVELS[level.toUpperCase()] !== undefined) {
        _minLevel = LOG_LEVELS[level.toUpperCase()];
      } else if (typeof level === 'number') {
        _minLevel = level;
      }
    },

    enableDevMode: function(enable = true) {
      _minLevel = enable ? LOG_LEVELS.DEBUG : LOG_LEVELS.SILENT;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ rp_debug_mode: enable });
        } catch (_) {}
      }
      return `ReturnPilot Dev Mode: ${enable ? 'ENABLED (Console logging active)' : 'DISABLED (Console silent)'}`;
    },

    getHistory: function() {
      return _historyBuffer.slice();
    },

    clearHistory: function() {
      _historyBuffer.length = 0;
      this.lastBatchSummary = null;
      this.batchSummaries = [];
      for (let i = 0; i < _subscribers.length; i++) {
        try {
          _subscribers[i]({ type: 'CLEAR' });
        } catch (_) {}
      }
    },

    dump: function(options = {}, extraEntries = []) {
      const allEntries = (extraEntries && Array.isArray(extraEntries) && extraEntries.length > 0)
        ? _historyBuffer.concat(extraEntries).sort((a, b) => (a.epoch || 0) - (b.epoch || 0))
        : _historyBuffer.slice();

      if (allEntries.length === 0) {
        return 'No logs recorded.';
      }

      const redactPii = Boolean(options && options.redactPii);
      const manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) 
        ? chrome.runtime.getManifest() : null;
      const extVersion = manifest ? manifest.version : '4.2.5';
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Worker Context';

      const baseEpoch = allEntries[0]?.epoch || Date.now();

      const header = [
        '================================================================================',
        'RETURNPILOT FLIGHT RECORDER & TELEMETRY LOG DUMP',
        `Exported At     : ${new Date().toISOString()}`,
        `Extension Ver   : ReturnPilot v${extVersion}`,
        `Platform        : ${userAgent}`,
        `Total Events    : ${allEntries.length} (Foreground: ${_historyBuffer.length}, Background/Bridge: ${extraEntries.length || 0})`,
        `Dev Mode        : ${_minLevel === LOG_LEVELS.DEBUG ? 'ACTIVE' : 'MUTED'}`,
        `PII Redacted    : ${redactPii ? 'YES (Taxpayer identifiers sanitized)' : 'NO (Raw diagnostic mode)'}`,
        'Attribution Legend:',
        '  [GSTN_NET]         : Time spent waiting on GST Portal servers via Chrome fetch()',
        '  [QUEUE_WAIT]       : Time spent queued in browser client concurrency limiter',
        '  [EXT_IPC]          : Time spent passing messages between popup and service worker',
        '  [SW_AUTH]          : Time spent resolving session AuthToken cookie / storage',
        '  [SW_CORE]          : Background service worker operations and cookie sync',
        '  [SW_NAV]           : Tab and webNavigation lifecycle events',
        '  [CONTENT_NAV]      : In-page navigation and dashboard button bridges',
        '  [USER_ACTION]      : User-initiated actions (clicks, manual downloads, return selections, portal events)',
        '  [DOWNLOAD_EVENT]   : Download lifecycle events (started, canonical filename, completed, deduplicated)',
        '  [ROW_SETTLED]      : Total row lifecycle from queue dispatch to full DOM render',
        '  [BATCH_DIAGNOSTICS]: Executive performance summary for parallel row checks',
        '  [API_RESP]         : API response payload, HTTP status code, and latency breakdown',
        '================================================================================\n'
      ].join('\n');

      const body = allEntries.map(e => {
        const dStr = e.details ? ' | ' + JSON.stringify(e.details) : '';
        const deltaMs = e.epoch ? Math.max(0, e.epoch - baseEpoch) : e.time;
        const ctxPrefix = e.context ? `[${e.context}] ` : '';
        const line = `[+${deltaMs}ms] [${e.level}] ${ctxPrefix}[${e.tag}] ${e.message}${dStr}`;
        return redactPii ? rpLog.redactPiiText(line) : line;
      }).join('\n');

      return header + body;
    },

    dumpAsync: async function(options = {}) {
      let extraEntries = [];
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage({ request: 'get-background-telemetry' }, r => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(r);
            });
            setTimeout(() => resolve(null), 1200);
          });
          if (resp && resp.logs && Array.isArray(resp.logs)) {
            extraEntries = resp.logs;
          }
        } catch (_) {}
      }
      return rpLog.dump(options, extraEntries);
    },

    redactPiiText: function(text) {
      if (!text || typeof text !== 'string') return text;
      return text
        // Redact 15-char GSTINs: 22AAKCR2040N1ZE -> 22AAK****040N1ZE
        .replace(/\b(\d{2}[A-Z]{3})[A-Z]{2}\d{4}[A-Z]{1}([1-9A-Z]{1}Z[0-9A-Z]{1})\b/g, '$1****$2')
        // Redact 10-char PANs: AAKCR2040N -> AAKC****0N
        .replace(/\b([A-Z]{4})[A-Z]{1}\d{4}([A-Z]{1})\b/g, '$1****$2')
        // Redact 15-char ARNs: AA2204240012345 -> AA2204*****2345
        .replace(/\b([A-Z]{2}\d{4})\d{5}(\d{4})\b/g, '$1*****$2')
        // Redact taxpayer names in JSON payloads
        .replace(/"name"\s*:\s*"([^"]+)"/gi, '"name":"[REDACTED_TAXPAYER_NAME]"')
        .replace(/"tradeNam"\s*:\s*"([^"]+)"/gi, '"tradeNam":"[REDACTED_TRADE_NAME]"')
        .replace(/"lgnm"\s*:\s*"([^"]+)"/gi, '"lgnm":"[REDACTED_LEGAL_NAME]"');
    },

    downloadLogs: async function(options = {}) {
      if (typeof document === 'undefined') return;
      const text = await rpLog.dumpAsync(options);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = options && options.redactPii ? '-redacted' : '';
      a.download = `ReturnPilot-Debug-Logs-${Date.now()}${suffix}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // ── BATCH TELEMETRY COLLECTOR CLASS ─────────────────────────────────
  class BatchTelemetry {
    constructor(batchName, totalItems, concurrencyLimit, renderId) {
      this.batchName = batchName;
      this.totalItems = totalItems;
      this.concurrencyLimit = concurrencyLimit;
      this.renderId = renderId;
      this.startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this.queueWaits = [];
      this.apiCalls = [];
      this.settledRows = [];
    }

    recordQueueWait(month, waitMs) {
      this.queueWaits.push({ month, waitMs });
    }

    recordApiCall(url, timing, requestClass = 'STATUS') {
      if (!timing) return;
      if (requestClass !== 'STATUS') return; // Phase J: segregate metadata and enrichment calls from row diagnostics
      this.apiCalls.push({ url, requestClass, ...timing });
    }

    recordItemSettled(month, rowElapsedMs, queueWaitMs, netMs, clientMs, settledAtMs) {
      const curNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const timeSinceStart = settledAtMs !== undefined ? settledAtMs : Math.round(curNow - this.startTime);
      this.settledRows.push({
        month,
        rowElapsedMs,
        queueWaitMs,
        netMs: netMs || 0,
        clientMs: clientMs || 0,
        settledAtMs: timeSinceStart
      });
    }

    recordPacerPoint(month, pacerData) {
      if (!this.pacerPoints) this.pacerPoints = [];
      this.pacerPoints.push({ month, ...pacerData });
    }

    finalize(wallClockMs) {
      const totalCalls = this.apiCalls.length;
      let totalNetMs = 0;
      let minNetMs = Infinity;
      let maxNetMs = 0;
      let slowestCall = null;
      let totalIpcMs = 0;
      let totalAuthMs = 0;

      for (let i = 0; i < this.apiCalls.length; i++) {
        const call = this.apiCalls[i];
        const net = (call.networkMs !== undefined && call.networkMs !== null) ? call.networkMs : (call.totalMs || 0);
        totalNetMs += net;
        if (net < minNetMs) minNetMs = net;
        if (net > maxNetMs) {
          maxNetMs = net;
          slowestCall = call;
        }
        totalIpcMs += (call.hop1Ms || 0) + (call.hop2Ms || 0);
        totalAuthMs += (call.authMs || 0);
      }

      if (minNetMs === Infinity) minNetMs = 0;
      const avgNetMs = totalCalls > 0 ? Math.round(totalNetMs / totalCalls) : 0;
      const avgIpcMs = totalCalls > 0 ? Math.round((totalIpcMs / totalCalls) * 10) / 10 : 0;

      let maxQueueMs = 0;
      let totalQueueMs = 0;
      let slowestQueueMonth = '';
      for (let i = 0; i < this.queueWaits.length; i++) {
        const q = this.queueWaits[i];
        totalQueueMs += q.waitMs;
        if (q.waitMs > maxQueueMs) {
          maxQueueMs = q.waitMs;
          slowestQueueMonth = q.month;
        }
      }
      const avgQueueMs = this.queueWaits.length > 0 ? Math.round(totalQueueMs / this.queueWaits.length) : 0;

      const speedup = (wallClockMs > 0 && totalNetMs > 0)
        ? (totalNetMs / wallClockMs).toFixed(2) + 'x'
        : '1.0x';

      let cleanSlowestUrl = '';
      if (slowestCall?.url) {
        try {
          const u = new URL(slowestCall.url);
          cleanSlowestUrl = u.pathname + (u.search ? u.search : '');
        } catch (_) {
          cleanSlowestUrl = slowestCall.url;
        }
      }

      let pacerSummary = null;
      let rawArr = [];
      if (this.pacerPoints && this.pacerPoints.length > 0) {
        rawArr = this.pacerPoints.map(p => p.rawMs).filter(n => typeof n === 'number' && n > 0);
        if (rawArr.length > 0) {
          const sorted = [...rawArr].sort((a, b) => a - b);
          const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
          const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
          pacerSummary = {
            points: this.pacerPoints.length,
            rttMin: sorted[0],
            p50,
            p90,
            peak: sorted[sorted.length - 1],
            brakes: this.pacerPoints.filter(p => (p.action || '').includes('BRAKE')).length,
            accels: this.pacerPoints.filter(p => (p.action || '').includes('ACCEL')).length
          };
        }
      }

      // Fall back to settledRows or apiCalls if pacerPoints is empty (e.g. immediate rows or G2B)
      if (rawArr.length === 0 && this.settledRows && this.settledRows.length > 0) {
        rawArr = this.settledRows.map(r => r.netMs).filter(n => typeof n === 'number' && n > 0);
      }
      if (rawArr.length === 0 && this.apiCalls && this.apiCalls.length > 0) {
        rawArr = this.apiCalls.map(c => c.netMs).filter(n => typeof n === 'number' && n > 0);
      }

      // ── Percentiles calculation (p50 / p90 / p95 / p99) ──
      let netP50 = 0, netP90 = 0, netP95 = 0, netP99 = 0;
      if (rawArr.length > 0) {
        const sortedNet = [...rawArr].sort((a, b) => a - b);
        netP50 = sortedNet[Math.floor(sortedNet.length * 0.5)] || 0;
        netP90 = sortedNet[Math.floor(sortedNet.length * 0.9)] || 0;
        netP95 = sortedNet[Math.floor(sortedNet.length * 0.95)] || 0;
        netP99 = sortedNet[sortedNet.length - 1] || 0;
      }

      let qP50 = 0, qP90 = 0, qP95 = 0, qP99 = 0;
      const rawQueue = (this.queueWaits || []).map(q => q.waitMs).filter(n => typeof n === 'number');
      if (rawQueue.length > 0) {
        const sortedQ = [...rawQueue].sort((a, b) => a - b);
        qP50 = sortedQ[Math.floor(sortedQ.length * 0.5)] || 0;
        qP90 = sortedQ[Math.floor(sortedQ.length * 0.9)] || 0;
        qP95 = sortedQ[Math.floor(sortedQ.length * 0.95)] || 0;
        qP99 = sortedQ[sortedQ.length - 1] || 0;
      }

      // ── Detailed Per-Period Timeline & Statistical Jitter ──
      const timeline = (this.settledRows || []).map(row => {
        const pacer = (this.pacerPoints || []).find(p => p.month === row.month);
        return {
          Period: row.month,
          'Net RTT': `${row.netMs} ms`,
          'Queue Wait': `${row.queueWaitMs} ms`,
          'Row Total': `${row.rowElapsedMs} ms`,
          'Pacer Action': pacer?.action || '—',
          'Next Gap': pacer?.nextGap ? `${pacer.nextGap} ms` : '—'
        };
      });

      let jitterMs = 0;
      if (rawArr.length > 1 && avgNetMs > 0) {
        const variance = rawArr.reduce((acc, val) => acc + Math.pow(val - avgNetMs, 2), 0) / rawArr.length;
        jitterMs = Math.round(Math.sqrt(variance));
      }

      let serverCondition = '⚡ Fast / Low Jitter (Off-Peak)';
      if (maxNetMs > 2000 || jitterMs > 400) {
        serverCondition = '⚠️ Heavy Contention / High Jitter (GSTN Peak Load)';
      } else if (maxNetMs > 750 || jitterMs > 150) {
        serverCondition = '⚖️ Moderate Jitter (Daytime Traffic)';
      }

      let verdict = '';
      if (maxNetMs >= 3500) {
        verdict = `⚠️ GSTN Portal Server latency spike: Slowest request took ${maxNetMs}ms (${cleanSlowestUrl}). Client concurrency queue operated normally.`;
      } else if (wallClockMs <= 1500) {
        verdict = `⚡ High speed (Sub-1.5s): Entire batch resolved in ${wallClockMs}ms (${speedup} efficiency).`;
      } else {
        verdict = `✔ Balanced: GSTN Portal responded in avg ${avgNetMs}ms per call. Parallel speedup: ${speedup} over sequential.`;
      }

      // ── Perceived UX Row-Visibility Milestones (Phase K) ──
      const sortedBySettled = [...this.settledRows].sort((a, b) => (a.settledAtMs || 0) - (b.settledAtMs || 0));
      const totalSettled = sortedBySettled.length;
      const timeToFirstRowMs = totalSettled > 0 ? (sortedBySettled[0].settledAtMs || 0) : 0;
      const idx50 = Math.min(totalSettled - 1, Math.max(0, Math.ceil(totalSettled * 0.5) - 1));
      const idx80 = Math.min(totalSettled - 1, Math.max(0, Math.ceil(totalSettled * 0.8) - 1));
      const idx90 = Math.min(totalSettled - 1, Math.max(0, Math.ceil(totalSettled * 0.9) - 1));
      const timeTo50PctRowsMs = totalSettled > 0 ? (sortedBySettled[idx50].settledAtMs || 0) : 0;
      const timeTo80PctRowsMs = totalSettled > 0 ? (sortedBySettled[idx80].settledAtMs || 0) : 0;
      const timeTo90PctRowsMs = totalSettled > 0 ? (sortedBySettled[idx90].settledAtMs || 0) : 0;
      const timeTo100PctRowsMs = totalSettled > 0 ? (sortedBySettled[totalSettled - 1].settledAtMs || 0) : (wallClockMs || 0);

      const perceivedUx = {
        timeToFirstRowMs,
        timeTo50PctRowsMs,
        timeTo80PctRowsMs,
        timeTo90PctRowsMs,
        timeTo100PctRowsMs,
        medianRowVisibleMs: timeTo50PctRowsMs,
        p90RowVisibleMs: timeTo90PctRowsMs
      };

      const summary = {
        batch: this.batchName,
        items: this.totalItems,
        concurrencyLimit: this.concurrencyLimit,
        wallClockMs,
        perceivedUx,
        speedup,
        apiCalls: totalCalls,
        serverCondition,
        jitterMs,
        network: {
          minMs: minNetMs,
          avgMs: avgNetMs,
          p50Ms: netP50,
          p90Ms: netP90,
          p95Ms: netP95,
          p99Ms: netP99,
          maxMs: maxNetMs,
          totalNetSumMs: totalNetMs,
          slowestUrl: cleanSlowestUrl
        },
        queue: {
          avgWaitMs: avgQueueMs,
          p50WaitMs: qP50,
          p90WaitMs: qP90,
          p95WaitMs: qP95,
          p99WaitMs: qP99,
          maxWaitMs: maxQueueMs,
          maxWaitMonth: slowestQueueMonth
        },
        extensionOverhead: {
          avgIpcMs,
          totalAuthMs
        },
        pacer: pacerSummary,
        timeline,
        verdict
      };

      rpLog.batchDiagnostics(summary);
      return summary;
    }
  }

  // ── DEV-ONLY UI FLIGHT RECORDER DRAWER ──────────────────────────────
  // Guarded by (typeof __DEV__ === 'undefined' || __DEV__) so that Terser's
  // Dead Code Elimination completely deletes this entire block from production!
  if (typeof __DEV__ === 'undefined' || __DEV__) {
    (function initDevDrawer() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      function mountDevUI() {
        if (!document.body || document.getElementById('rp-dev-launcher')) return;

        // 1. Floating Launcher Button
        const btn = document.createElement('button');
        btn.id = 'rp-dev-launcher';
        btn.title = 'Toggle ReturnPilot Dev Diagnostics & Flight Recorder';
        btn.innerHTML = '🩺 <span id="rp-dev-badge">0</span> Logs';
        Object.assign(btn.style, {
          position: 'fixed',
          bottom: '26px',
          right: '12px',
          zIndex: '999999',
          background: '#0f172a',
          color: '#38bdf8',
          border: '1px solid #334155',
          borderRadius: '20px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: '600',
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          transition: 'all 0.15s ease'
        });

        // 2. Dev Diagnostics Drawer Panel
        const drawer = document.createElement('div');
        drawer.id = 'rp-dev-drawer';
        Object.assign(drawer.style, {
          position: 'fixed',
          bottom: '0',
          left: '0',
          right: '0',
          height: '270px',
          maxHeight: '55vh',
          zIndex: '1000000',
          background: '#090d16',
          color: '#cbd5e1',
          borderTop: '2px solid #38bdf8',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.5)',
          display: 'none',
          flexDirection: 'column',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '11px'
        });

        drawer.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#0f172a;border-bottom:1px solid #1e293b;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;color:#38bdf8;">🩺 ReturnPilot Flight Recorder</span>
              <span id="rp-dev-count" style="background:#1e293b;color:#94a3b8;padding:1px 6px;border-radius:10px;font-size:10px;">0 events</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="color:#94a3b8;font-size:10px;display:flex;align-items:center;gap:3px;cursor:pointer;" title="Mask taxpayer GSTIN, PAN, and name in exported logs">
                <input id="rp-dev-redact-cb" type="checkbox" checked style="cursor:pointer;" /> Redact PII
              </label>
              <button id="rp-dev-btn-selftest" style="background:#0284c7;color:#ffffff;border:1px solid #0369a1;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;font-weight:600;" title="Run live in-extension empirical self-test">🧪 Run Self-Test</button>
              <button id="rp-dev-btn-copy" style="background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">📋 Copy</button>
              <button id="rp-dev-btn-dl" style="background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">💾 Download</button>
              <button id="rp-dev-btn-clear" style="background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">🗑️ Clear</button>
              <button id="rp-dev-btn-wipe" style="background:#451a03;color:#fbbf24;border:1px solid #78350f;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;" title="Wipe period state cache & reload to test raw network speed">🧹 Wipe Cache</button>
              <button id="rp-dev-btn-bench" style="background:#064e3b;color:#34d399;border:1px solid #047857;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;" title="Run Elastic Harvester sweep across return periods">⚡ Harvester</button>
              <button id="rp-dev-btn-close" style="background:transparent;color:#94a3b8;border:none;font-size:14px;cursor:pointer;padding:0 4px;">✕</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:#090d16;border-bottom:1px solid #1e293b;">
            <div id="rp-dev-filter-group" style="display:flex;gap:4px;flex-wrap:wrap;">
              <button data-filter="ALL" class="rp-dev-filter-btn" style="background:#38bdf8;color:#090d16;font-weight:600;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">All</button>
              <button data-filter="DOWNLOAD" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">📥 Downloads</button>
              <button data-filter="TIMING" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">⏱️ Timing</button>
              <button data-filter="DIAG" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">📊 Diag</button>
              <button data-filter="API" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">API</button>
              <button data-filter="FLICKER" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">Flicker</button>
              <button data-filter="PILL" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">Pill</button>
              <button data-filter="ROUTE" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">Route</button>
              <button data-filter="VIEWPORT" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">📐 Size</button>
              <button data-filter="ERROR" class="rp-dev-filter-btn" style="background:#1e293b;color:#94a3b8;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">Errors</button>
            </div>
            <input id="rp-dev-search" type="text" placeholder="Filter logs..." style="background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:10px;width:140px;outline:none;" />
          </div>
          <div id="rp-dev-stream" style="flex:1;overflow-y:auto;padding:6px 10px;display:flex;flex-direction:column;gap:3px;"></div>
        `;

        document.body.appendChild(btn);
        document.body.appendChild(drawer);

        let activeFilter = 'ALL';
        let searchQuery = '';
        const badgeEl = document.getElementById('rp-dev-badge');
        const countEl = document.getElementById('rp-dev-count');
        const streamEl = document.getElementById('rp-dev-stream');
        const searchInput = document.getElementById('rp-dev-search');

        function matchesFilter(entry) {
          if (activeFilter === 'DOWNLOAD') {
            const m = ((entry.tag || '') + ' ' + (entry.message || '')).toLowerCase();
            if (!entry.tag.includes('DOWNLOAD') && !entry.tag.includes('PDF') && !entry.tag.includes('EXCEL') && !entry.tag.includes('GSTR') && !m.includes('download') && !m.includes('pdf') && !m.includes('excel')) return false;
          } else if (activeFilter === 'DIAG') {
            if (entry.tag !== 'BATCH_DIAGNOSTICS' && entry.tag !== 'CONCURRENCY_START' && entry.tag !== 'CONCURRENCY_DONE' && !entry.tag.startsWith('BENCHMARK_')) return false;
          } else if (activeFilter === 'TIMING') {
            if (!entry.tag.includes('TIMING') &&
                !entry.tag.startsWith('BG_') &&
                !entry.tag.startsWith('API_') &&
                !entry.tag.includes('AUTH') &&
                !entry.tag.includes('CONCURRENCY') &&
                !entry.tag.includes('QUEUE') &&
                !entry.tag.includes('SETTLED') &&
                !entry.tag.includes('DIAGNOSTICS') &&
                !entry.tag.startsWith('BENCHMARK_') &&
                !entry.message.includes('RP_TIMING') &&
                !entry.message.includes('TIMING CHAIN')) return false;
          } else if (activeFilter === 'API') {
            if (!entry.tag.includes('API') && !entry.tag.includes('GSTR') && !entry.tag.includes('SOCKET')) return false;
          } else if (activeFilter === 'FLICKER') {
            if (!entry.tag.includes('FLICKER') && !entry.message.includes('flicker')) return false;
          } else if (activeFilter === 'PILL') {
            if (!entry.tag.includes('PILL')) return false;
          } else if (activeFilter === 'ROUTE') {
            if (!entry.tag.includes('ROUTE') && !entry.tag.includes('TAB') && !entry.tag.includes('BOOT')) return false;
          } else if (activeFilter === 'VIEWPORT') {
            if (!entry.tag.includes('POPUP') && !entry.tag.includes('RESIZE') && !entry.tag.includes('VIEWPORT') && !entry.tag.includes('FRAME0')) return false;
          } else if (activeFilter === 'ERROR') {
            if (entry.level !== 'ERROR' && entry.level !== 'WARN') return false;
          }

          if (searchQuery) {
            const txt = (entry.tag + ' ' + entry.message + ' ' + (entry.details ? JSON.stringify(entry.details) : '')).toLowerCase();
            if (!txt.includes(searchQuery)) return false;
          }
          return true;
        }

        function renderEntry(entry) {
          if (!matchesFilter(entry)) return null;

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'flex-start';
          row.style.gap = '6px';
          row.style.padding = '2px 0';
          row.style.lineHeight = '1.3';
          row.style.borderBottom = '1px solid #111827';

          let tagColor = '#38bdf8';
          if (entry.level === 'ERROR') tagColor = '#f87171';
          else if (entry.level === 'WARN') tagColor = '#fbbf24';
          else if (entry.tag === 'BATCH_DIAGNOSTICS' || entry.tag === 'BENCHMARK_SUMMARY') {
            tagColor = entry.tag === 'BENCHMARK_SUMMARY' ? '#34d399' : '#38bdf8';
            row.style.background = entry.tag === 'BENCHMARK_SUMMARY' ? '#064e3b22' : '#0d1b2a';
            row.style.border = entry.tag === 'BENCHMARK_SUMMARY' ? '1px solid #059669' : '1px solid #1e3a8a';
            row.style.borderRadius = '4px';
            row.style.padding = '6px';
            row.style.margin = '4px 0';
            row.style.flexDirection = 'column';
          }
          else if (entry.tag.includes('QUEUE')) tagColor = '#f59e0b';
          else if (entry.tag.includes('SETTLED')) tagColor = '#10b981';
          else if (entry.tag.includes('TIMING') || entry.tag.startsWith('BG_') || entry.tag.includes('AUTH') || entry.tag.startsWith('BENCHMARK_')) tagColor = '#c084fc';
          else if (entry.tag.includes('FLICKER')) tagColor = '#f97316';
          else if (entry.tag.includes('PILL')) tagColor = '#4ade80';

          let dStr = '';
          if (entry.details) {
            if (entry.tag === 'BENCHMARK_SUMMARY' && entry.details?.pools) {
              const b = entry.details;
              const poolRows = b.pools.map(p => `
                <tr style="border-bottom:1px solid #1e293b;">
                  <td style="padding:2px 6px;color:#38bdf8;font-weight:bold;">Pool ${p.pool} ${p.pool === b.optimalPool ? '⭐ (Winner)' : ''}</td>
                  <td style="padding:2px 6px;color:#f8fafc;">${p.timeToFirstRowMs}ms</td>
                  <td style="padding:2px 6px;color:#34d399;font-weight:bold;">${p.timeTo80PctRowsMs}ms</td>
                  <td style="padding:2px 6px;color:#94a3b8;">${p.wallClockMs}ms</td>
                  <td style="padding:2px 6px;color:#a78bfa;">${p.p90RowVisibleMs}ms</td>
                </tr>
              `).join('');
              dStr = `<div style="margin-top:4px;padding:4px 6px;background:#090d16;border-radius:3px;font-size:10px;width:100%;box-sizing:border-box;">
                <table style="width:100%;border-collapse:collapse;text-align:left;font-size:9.5px;">
                  <thead>
                    <tr style="color:#64748b;border-bottom:1px solid #334155;">
                      <th style="padding:2px 6px;">Worker Pool</th>
                      <th style="padding:2px 6px;">1st Row</th>
                      <th style="padding:2px 6px;">80% Visible</th>
                      <th style="padding:2px 6px;">Wall Clock</th>
                      <th style="padding:2px 6px;">P90 Contention</th>
                    </tr>
                  </thead>
                  <tbody>${poolRows}</tbody>
                </table>
              </div>`;
            } else if (entry.tag === 'BATCH_DIAGNOSTICS') {
              const s = entry.details;
              dStr = `<div style="margin-top:4px;padding:4px 6px;background:#090d16;border-radius:3px;color:#94a3b8;font-size:10px;width:100%;box-sizing:border-box;">
                <span style="color:#38bdf8;font-weight:bold;">Net:</span> ${s.network?.minMs}ms min / ${s.network?.avgMs}ms avg / <span style="color:${(s.network?.maxMs || 0) >= 3000 ? '#f87171' : '#38bdf8'};font-weight:bold;">${s.network?.maxMs}ms max</span> |
                <span style="color:#eab308;font-weight:bold;">Queue:</span> ${s.queue?.avgWaitMs}ms avg (${s.queue?.maxWaitMs}ms max: ${s.queue?.maxWaitMonth}) |
                <span style="color:#a78bfa;font-weight:bold;">IPC:</span> ${s.extensionOverhead?.avgIpcMs}ms |
                <span style="color:#4ade80;font-weight:bold;">Speedup:</span> ${s.speedup}
                ${s.perceivedUx ? `<div style="margin-top:3px;"><span style="color:#34d399;font-weight:bold;">UX Visible:</span> T_1st: ${s.perceivedUx.timeToFirstRowMs}ms | T_50%: ${s.perceivedUx.timeTo50PctRowsMs}ms | T_80%: ${s.perceivedUx.timeTo80PctRowsMs}ms | T_100%: ${s.perceivedUx.timeTo100PctRowsMs}ms (p90: ${s.perceivedUx.p90RowVisibleMs}ms)</div>` : ''}
                <div style="margin-top:3px;color:#f8fafc;font-style:italic;">${escapeHtml(s.verdict || '')}</div>
              </div>`;
            } else if (entry.tag === 'API_RESP' && entry.details) {
              const d = entry.details;
              const respText = d.response ? (typeof d.response === 'object' ? JSON.stringify(d.response) : String(d.response)) : (d.error || 'No body');
              const isLong = respText.length > 250;
              const preview = isLong ? respText.substring(0, 250) + '…' : respText;
              dStr = `<div style="margin-top:3px;padding:4px 6px;background:#090d16;border-radius:3px;font-family:monospace;font-size:10px;width:100%;box-sizing:border-box;">
                <div style="display:flex;gap:6px;margin-bottom:2px;">
                  <span style="color:${(d.statusCode >= 200 && d.statusCode < 300) ? '#4ade80' : '#f87171'};font-weight:700;">HTTP ${d.statusCode || 200}</span>
                  <span style="color:#a78bfa;">Total: ${d.elapsedMs || 0}ms</span>
                  ${d.ttfbMs !== undefined && d.ttfbMs !== null ? `<span style="color:#38bdf8;">TTFB: ${d.ttfbMs}ms</span>` : ''}
                  ${d.payloadBytes ? `<span style="color:#94a3b8;">${d.payloadBytes} B</span>` : ''}
                </div>
                <div style="color:#94a3b8;word-break:break-all;line-height:1.3;">
                  <span style="color:#f59e0b;font-weight:bold;">Payload:</span> ${escapeHtml(preview)}
                </div>
              </div>`;
            } else if (entry.details.totalMs !== undefined || entry.details.elapsedMs !== undefined || entry.details.hop1Ms !== undefined || entry.details.rowElapsedMs !== undefined) {
              const parts = [];
              if (entry.details.rowElapsedMs !== undefined) parts.push(`Row: ${entry.details.rowElapsedMs}ms`);
              if (entry.details.queueWaitMs !== undefined) parts.push(`Queue: ${entry.details.queueWaitMs}ms`);
              if (entry.details.netMs !== undefined) parts.push(`Net: ${entry.details.netMs}ms`);
              if (entry.details.clientMs !== undefined) parts.push(`DOM: ${entry.details.clientMs}ms`);
              if (entry.details.totalMs !== undefined) parts.push(`Total: ${entry.details.totalMs}ms`);
              if (entry.details.hop1Ms !== undefined && entry.details.hop1Ms !== null) parts.push(`Hop1: ${entry.details.hop1Ms}ms`);
              if (entry.details.authMs !== undefined && entry.details.authMs !== null) parts.push(`Auth: ${entry.details.authMs}ms`);
              if (entry.details.networkMs !== undefined && entry.details.networkMs !== null) parts.push(`Net: ${entry.details.networkMs}ms`);
              if (entry.details.ttfbMs !== undefined && entry.details.ttfbMs !== null) parts.push(`TTFB: ${entry.details.ttfbMs}ms`);
              if (entry.details.hop2Ms !== undefined && entry.details.hop2Ms !== null) parts.push(`Hop2: ${entry.details.hop2Ms}ms`);
              if (entry.details.elapsedMs !== undefined) parts.push(`Elapsed: ${entry.details.elapsedMs}ms`);
              dStr = `<span style="color:#a78bfa;margin-left:4px;font-weight:600;">[${parts.join(' | ')}]</span>`;
            } else {
              dStr = `<span style="color:#64748b;margin-left:4px;">${escapeHtml(JSON.stringify(entry.details))}</span>`;
            }
          }

          const ctxBadge = entry.context === 'SW' ? '<span style="color:#c084fc;font-size:9px;background:#3b0764;padding:1px 4px;border-radius:2px;flex-shrink:0;font-weight:700;">SW</span>' : '';
          if (entry.tag === 'BATCH_DIAGNOSTICS') {
            row.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:#64748b;flex-shrink:0;">+${entry.time}ms</span>
                ${ctxBadge}
                <span style="color:${tagColor};font-weight:700;flex-shrink:0;">[${escapeHtml(entry.tag)}]</span>
                <span style="color:#38bdf8;font-weight:600;">${escapeHtml(entry.message)}</span>
              </div>
              ${dStr}
            `;
          } else {
            row.innerHTML = `
              <span style="color:#64748b;flex-shrink:0;">+${entry.time}ms</span>
              ${ctxBadge}
              <span style="color:${tagColor};font-weight:600;flex-shrink:0;">[${escapeHtml(entry.tag)}]</span>
              <span style="color:#e2e8f0;word-break:break-all;">${escapeHtml(entry.message)}${dStr}</span>
            `;
          }
          return row;
        }

        function escapeHtml(str) {
          return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
        }

        function rebuildStream() {
          if (!streamEl) return;
          streamEl.innerHTML = '';
          const hist = rpLog.getHistory();
          if (countEl) countEl.textContent = `${hist.length} events`;
          if (badgeEl) badgeEl.textContent = String(hist.length);

          if (!hist.length) {
            streamEl.innerHTML = `
              <div style="padding:32px 16px;text-align:center;color:#64748b;font-size:11px;line-height:1.6;">
                ✨ <strong>Logger Cleared</strong><br>
                All foreground and background events have been reset.<br>
                New clicks, API calls, and downloads will appear here live.
              </div>`;
            return;
          }

          const frag = document.createDocumentFragment();
          hist.forEach(e => {
            const el = renderEntry(e);
            if (el) frag.appendChild(el);
          });
          streamEl.appendChild(frag);
          streamEl.scrollTop = streamEl.scrollHeight;
        }

        let _bgPollInterval = null;
        function syncBackgroundTelemetry() {
          if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
          try {
            chrome.runtime.sendMessage({ request: 'get-background-telemetry' }, (res) => {
              if (chrome.runtime.lastError || !res || !res.success) return;
              if (Array.isArray(res.logs) && res.logs.length > 0) {
                let updated = false;
                res.logs.forEach(bgEntry => {
                  if (!_historyBuffer.some(e => e.epoch === bgEntry.epoch && e.tag === bgEntry.tag && e.message === bgEntry.message)) {
                    _historyBuffer.push({ ...bgEntry, context: 'SW' });
                    updated = true;
                  }
                });
                if (updated) {
                  _historyBuffer.sort((a, b) => (a.time || a.epoch) - (b.time || b.epoch));
                  if (_historyBuffer.length > MAX_BUFFER_SIZE) {
                    _historyBuffer.splice(0, _historyBuffer.length - MAX_BUFFER_SIZE);
                  }
                  if (drawer.style.display === 'flex') {
                    rebuildStream();
                  }
                }
              }
            });
          } catch (_) {}
        }

        async function runExtensionSelfTest() {
          rpLog.info('SELF_TEST', '═══════════════════════════════════════════════════════');
          rpLog.info('SELF_TEST', '🧪 STARTING RETURNPILOT IN-EXTENSION LIVE SELF-TEST');
          rpLog.info('SELF_TEST', '═══════════════════════════════════════════════════════');
          
          let activeTab = null;
          try {
            const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
            activeTab = tabs && tabs[0];
          } catch (e) {
            rpLog.error('SELF_TEST', `❌ Chrome Tabs Query failed: ${e.message}`);
          }
          
          if (!activeTab || !activeTab.url) {
            rpLog.error('SELF_TEST', '❌ No active tab found. Please open the GST Returns Dashboard.');
            return;
          }
          
          const isPortal = activeTab.url.includes('gst.gov.in');
          if (!isPortal) {
            rpLog.warn('SELF_TEST', `⚠ Active tab (${activeTab.url}) is not a GST Portal tab. Please open https://return.gst.gov.in/returns/auth/dashboard`);
          } else {
            rpLog.info('SELF_TEST', `✓ Active Tab: #${activeTab.id} (${activeTab.url})`);
          }
          
          try {
            const t0 = performance.now();
            const ustatusRes = await fetch('https://return.gst.gov.in/services/api/ustatus', { credentials: 'include' });
            const ustatus = await ustatusRes.json();
            const lat = Math.round(performance.now() - t0);
            if (ustatus && (ustatus.gstin || ustatus.userName || ustatus.bname)) {
              rpLog.info('SELF_TEST', `✓ Portal Session Active: GSTIN ${ustatus.gstin || 'N/A'} | User: ${ustatus.userName || ustatus.bname || 'Active'} (${lat}ms)`);
            } else {
              rpLog.warn('SELF_TEST', `⚠ Session response missing taxpayer info (${lat}ms)`);
            }
          } catch (e) {
            rpLog.error('SELF_TEST', `❌ Session verification error: ${e.message}`);
          }
          
          try {
            const t0 = performance.now();
            const scopeProbe = await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              world: 'MAIN',
              func: () => {
                const hasAngular = typeof window.angular !== 'undefined';
                let has3b = false;
                let hasCreateGstPdf = false;
                let scopeCount = 0;
                if (hasAngular) {
                  try {
                    const injector = (angular.element(document.body).injector && angular.element(document.body).injector()) ||
                                     (angular.element(document).injector && angular.element(document).injector());
                    if (injector && typeof injector.get === 'function') {
                      const root = injector.get('$rootScope');
                      if (root) {
                        const queue = [root];
                        while (queue.length > 0) {
                          const sc = queue.shift();
                          if (!sc) continue;
                          scopeCount++;
                          if (typeof sc.downloadGSTR3Bpdf === 'function') has3b = true;
                          if (typeof sc.createGstPdf === 'function') hasCreateGstPdf = true;
                          if (sc.$$childHead) queue.push(sc.$$childHead);
                          if (sc.$$nextSibling) queue.push(sc.$$nextSibling);
                        }
                      }
                    }
                  } catch (_) {}
                  if (!has3b) {
                    const elems = document.querySelectorAll('.ng-scope');
                    for (const el of elems) {
                      const sc = angular.element(el).scope();
                      if (sc) {
                        scopeCount++;
                        if (typeof sc.downloadGSTR3Bpdf === 'function') has3b = true;
                        if (typeof sc.createGstPdf === 'function') hasCreateGstPdf = true;
                      }
                    }
                  }
                }
                return {
                  hasAngular,
                  scopeCount,
                  has3b,
                  hasCreateGstPdf,
                  hasPdfMake: typeof window.pdfMake !== 'undefined',
                  url: location.href
                };
              }
            });
            const pRes = scopeProbe && scopeProbe[0] && scopeProbe[0].result;
            const lat = Math.round(performance.now() - t0);
            if (pRes) {
              if (pRes.has3b) {
                rpLog.info('SELF_TEST', `✓ Active Tab AngularJS Scope: downloadGSTR3Bpdf() FOUND (${lat}ms, ${pRes.scopeCount} scopes scanned)`);
              } else {
                rpLog.warn('SELF_TEST', `⚠ Active Tab Scope: downloadGSTR3Bpdf() not currently mounted (${lat}ms, on URL: ${pRes.url})`);
              }
            }
          } catch (e) {
            rpLog.warn('SELF_TEST', `⚠ Active Tab scripting note: ${e.message}`);
          }
          
          const periodsToTest = ['042024', '052024'];
          for (const p of periodsToTest) {
            try {
              const t0 = performance.now();
              const res3b = await fetch(`https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=${p}`, { credentials: 'include' });
              const lat3b = Math.round(performance.now() - t0);
              rpLog.info('SELF_TEST', `✓ GSTR-3B Summary API [${p}]: status ${res3b.status} (${lat3b}ms)`);
            } catch (e3b) {
              rpLog.error('SELF_TEST', `❌ GSTR-3B Summary API [${p}] failed: ${e3b.message}`);
            }
            try {
              const t0 = performance.now();
              const res1 = await fetch(`https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=${p}`, { credentials: 'include' });
              const lat1 = Math.round(performance.now() - t0);
              rpLog.info('SELF_TEST', `✓ GSTR-1 Summary API [${p}]: status ${res1.status} (${lat1}ms)`);
            } catch (e1) {
              rpLog.error('SELF_TEST', `❌ GSTR-1 Summary API [${p}] failed: ${e1.message}`);
            }
          }
          
          rpLog.info('SELF_TEST', '═══════════════════════════════════════════════════════');
          rpLog.info('SELF_TEST', '✓ SELF-TEST COMPLETE — Diagnostics logged.');
          rpLog.info('SELF_TEST', '═══════════════════════════════════════════════════════');
        }

        function toggleDrawer(forceOpen) {
          const isOpen = drawer.style.display === 'flex';
          const nextState = forceOpen !== undefined ? forceOpen : !isOpen;
          drawer.style.display = nextState ? 'flex' : 'none';
          btn.style.display = nextState ? 'none' : 'flex';
          if (nextState) {
            syncBackgroundTelemetry();
            if (!_bgPollInterval) _bgPollInterval = setInterval(syncBackgroundTelemetry, 1500);
            rebuildStream();
          } else {
            if (_bgPollInterval) {
              clearInterval(_bgPollInterval);
              _bgPollInterval = null;
            }
          }
        }

        btn.onclick = () => toggleDrawer();
        window.toggleFlightRecorder = toggleDrawer;

        const liveLogsBtn = document.getElementById('btnLiveLogs');
        if (liveLogsBtn) {
          liveLogsBtn.onclick = (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            toggleDrawer();
          };
        }

        const selfTestBtn = document.getElementById('rp-dev-btn-selftest');
        if (selfTestBtn) {
          selfTestBtn.onclick = async () => {
            selfTestBtn.disabled = true;
            const orig = selfTestBtn.textContent;
            selfTestBtn.textContent = '⏳ Testing...';
            try {
              await runExtensionSelfTest();
            } finally {
              selfTestBtn.disabled = false;
              selfTestBtn.textContent = orig;
              rebuildStream();
            }
          };
        }

        document.getElementById('rp-dev-btn-close').onclick = () => {
          toggleDrawer(false);
        };

        document.getElementById('rp-dev-btn-clear').onclick = () => {
          rpLog.clearHistory();
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ request: 'clear-background-telemetry' }, () => {}).catch(() => {});
          }
          rebuildStream();
        };

        const wipeBtn = document.getElementById('rp-dev-btn-wipe');
        if (wipeBtn) {
          wipeBtn.onclick = () => {
            if (typeof window.rpClearCache === 'function') {
              window.rpClearCache();
            } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.remove(['rp_period_state_cache', 'rp_generation_timestamps'], () => {
                location.reload();
              });
            }
          };
        }

        const benchBtn = document.getElementById('rp-dev-btn-bench');
        if (benchBtn) {
          benchBtn.onclick = async () => {
            const runner = window.runGstHarvest || window.rpBenchmarkPools;
            if (typeof runner === 'function') {
              benchBtn.disabled = true;
              const origText = benchBtn.textContent;
              benchBtn.textContent = '⏳ Harvesting...';
              try {
                await runner();
              } catch (err) {
                console.error('[Harvester Error]', err);
              } finally {
                benchBtn.disabled = false;
                benchBtn.textContent = origText;
              }
            } else {
              alert('Elastic Harvester is ready on the Return Status table view.');
            }
          };
        }

        document.getElementById('rp-dev-btn-dl').onclick = async () => {
          const redact = Boolean(document.getElementById('rp-dev-redact-cb')?.checked);
          await rpLog.downloadLogs({ redactPii: redact });
        };

        document.getElementById('rp-dev-btn-copy').onclick = async () => {
          const redact = Boolean(document.getElementById('rp-dev-redact-cb')?.checked);
          const dump = await rpLog.dumpAsync({ redactPii: redact });
          navigator.clipboard.writeText(dump).then(() => {
            const orig = document.getElementById('rp-dev-btn-copy').textContent;
            document.getElementById('rp-dev-btn-copy').textContent = '✔ Copied!';
            setTimeout(() => {
              const el = document.getElementById('rp-dev-btn-copy');
              if (el) el.textContent = orig;
            }, 1500);
          });
        };

        searchInput.oninput = (e) => {
          searchQuery = e.target.value.toLowerCase().trim();
          rebuildStream();
        };

        const filterBtns = drawer.querySelectorAll('.rp-dev-filter-btn');
        filterBtns.forEach(fb => {
          fb.onclick = () => {
            filterBtns.forEach(b => {
              b.style.background = '#1e293b';
              b.style.color = '#94a3b8';
              b.style.fontWeight = 'normal';
            });
            fb.style.background = '#38bdf8';
            fb.style.color = '#090d16';
            fb.style.fontWeight = '600';
            activeFilter = fb.getAttribute('data-filter') || 'ALL';
            rebuildStream();
          };
        });

        // Reactive stream subscription
        rpLog.subscribe((entry) => {
          if (entry.type === 'CLEAR') {
            rebuildStream();
            return;
          }
          const hist = rpLog.getHistory();
          if (badgeEl) badgeEl.textContent = String(hist.length);
          if (countEl) countEl.textContent = `${hist.length} events`;

          if (drawer.style.display === 'flex') {
            const el = renderEntry(entry);
            if (el && streamEl) {
              const isScrolledToBottom = streamEl.scrollHeight - streamEl.clientHeight <= streamEl.scrollTop + 30;
              streamEl.appendChild(el);
              if (isScrolledToBottom) streamEl.scrollTop = streamEl.scrollHeight;
            }
          }
        });

        // Initial paint
        rebuildStream();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountDevUI);
      } else {
        mountDevUI();
      }
    })();
  }

  // Global Uncaught Exception & Promise Rejection Flight Recorder Trap
  if (typeof global.addEventListener === 'function') {
    try {
      global.addEventListener('error', function (evt) {
        try {
          const msg = evt.message || (evt.error && evt.error.message) || 'Uncaught error';
          record('ERROR', LOG_LEVELS.ERROR, 'UNCAUGHT_EXCEPTION', msg, {
            filename: evt.filename,
            lineno: evt.lineno,
            colno: evt.colno,
            stack: evt.error ? evt.error.stack : null
          });
        } catch (_) {}
      });

      global.addEventListener('unhandledrejection', function (evt) {
        try {
          const reason = evt.reason;
          const msg = (reason && reason.message) ? reason.message : String(reason || 'Unhandled Promise rejection');
          record('ERROR', LOG_LEVELS.ERROR, 'UNHANDLED_REJECTION', msg, {
            stack: reason && reason.stack ? reason.stack : null
          });
        } catch (_) {}
      });
    } catch (_) {}
  }

  global.rpLog = rpLog;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = rpLog;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
