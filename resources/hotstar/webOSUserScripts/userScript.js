/*
 * HotsOff user script for the Hotstar webOS app (livingroom.hotstar.com).
 *
 * webOS WebAppManager loads <app>/webOSUserScripts/userScript.js into every
 * page the app opens. HotsOff copies this file into the installed Hotstar app.
 *
 * What it does (ES5 only, old webOS browsers have no arrow functions etc.):
 *  1. Live/SSAI ads: drops "ssai" from the client_capabilities the player sends,
 *     so the server returns the clean, non ad-stitched stream. Same idea as the
 *     Morphe Android "Remove ads" patch (empty ssaiTag). The web app already
 *     uses this exact downgrade (removeSSAI -> ads:["non_ssai"]) as an error
 *     fallback, so the backend accepts it.
 *  2. VOD ads: removes preroll / midroll / pause-ad entries from the player
 *     "interventions" in API responses, blanks ssai_tag / live_stream_ad and
 *     removes display-ad widgets (DisplayAdWidget, ImageDisplayAdWidget, ...).
 *  3. Any VAST / VMAP ad response that still gets through is replaced by an
 *     empty one, so the player sees "no ads".
 *  4. Pause ads: drops the DELAYED_PAUSE_FOR_ADS event intervention that adds
 *     the DisplayAdContainerWidget overlay when the player is paused, and hides
 *     that overlay with CSS as a fallback.
 *  5. Removes the "Upgrade" / "Subscribe" entry of the side nav (next to the
 *     Hotstar logo) and SubscriptionNudgeWidget banners.
 *  6. Blocks third-party telemetry (Coralogix RUM, GTM, Moat, Firebase logging).
 */
(function () {
  'use strict';

  if (window.__HOTSOFF__) return;

  var VERSION = '0.2.0';
  var CONFIG = {
    stripSsai: true,
    stripInterventions: true,
    stripDisplayAds: true,
    stripPauseAds: true,
    hideUpgrade: true,
    emptyVast: true,
    blockTelemetry: true,
    toast: true
  };

  var stats = { caps: 0, json: 0, vast: 0, blocked: 0 };
  window.__HOTSOFF__ = { version: VERSION, config: CONFIG, stats: stats };

  // Only act inside Hotstar pages (the first page is a local redirect file).
  if (!/(^|\.)hotstar\.com$/.test(location.hostname)) return;

  function log(msg) {
    try { console.log('[HotsOff] ' + msg); } catch (e) {}
  }

  var isArray = Array.isArray || function (a) {
    return Object.prototype.toString.call(a) === '[object Array]';
  };

  // ---------------------------------------------------------------------------
  // URL classification
  // ---------------------------------------------------------------------------
  var TELEMETRY_RE = /rum-ingress-coralogix\.com|api\.coralogix\.com|googletagmanager\.com|google-analytics\.com|moatads\.com|firebaselogging\.googleapis\.com|firebaselogging-pa\.googleapis\.com|hspx\.hotstar\.com/i;
  var JSON_TARGET_RE = /hotstar\.com|hotstarext\.com|firebaseremoteconfig\.googleapis\.com/i;
  var AD_WIDGET_RE = /DisplayAd/;
  var AD_META_KEYS = ['preroll', 'midroll', 'instream_display', 'pause_ad'];
  var NUDGE_WIDGET_RE = /SubscriptionNudge/;
  var UPGRADE_TITLE_RE = /^\s*(upgrade|subscribe)\s*$/i;
  var PAUSE_AD_RE = /pause[-_ ]?ads?\b|DisplayAdContainer|instream_display/i;

  function absUrl(url) {
    url = String(url || '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    if (url.indexOf('//') === 0) return location.protocol + url;
    return location.protocol + '//' + location.host + (url.charAt(0) === '/' ? '' : '/') + url;
  }

  function isTelemetry(url) {
    return CONFIG.blockTelemetry && TELEMETRY_RE.test(absUrl(url));
  }

  function isJsonTarget(url) {
    return JSON_TARGET_RE.test(absUrl(url));
  }

  // ---------------------------------------------------------------------------
  // 1. Client capabilities: remove "ssai"
  // ---------------------------------------------------------------------------
  function fixCaps(caps) {
    if (!caps || typeof caps !== 'object' || !isArray(caps.ads)) return false;
    var out = [];
    for (var i = 0; i < caps.ads.length; i++) {
      if (caps.ads[i] !== 'ssai') out.push(caps.ads[i]);
    }
    if (out.length === caps.ads.length) return false;
    if (!out.length) out.push('non_ssai');
    caps.ads = out;
    return true;
  }

  // Walk a request payload and fix every client capabilities object in it.
  function fixCapsDeep(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return false;
    var changed = false;
    if (fixCaps(obj)) changed = true;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v && typeof v === 'object' && fixCapsDeep(v, depth + 1)) changed = true;
    }
    return changed;
  }

  function fixCapsString(str) {
    if (!CONFIG.stripSsai || typeof str !== 'string' || str.indexOf('ssai') < 0) return str;
    var t = str.replace(/^\s+/, '');
    if (t.charAt(0) !== '{' && t.charAt(0) !== '[') return str;
    try {
      var obj = JSON.parse(str);
      if (fixCapsDeep(obj, 0)) { stats.caps++; return JSON.stringify(obj); }
    } catch (e) {}
    return str;
  }

  function rewriteUrl(url) {
    if (!CONFIG.stripSsai || typeof url !== 'string') return url;
    var q = url.indexOf('?');
    if (q < 0 || url.indexOf('ssai', q) < 0) return url;
    var hash = '';
    var h = url.indexOf('#', q);
    if (h >= 0) { hash = url.slice(h); url = url.slice(0, h); }
    var parts = url.slice(q + 1).split('&');
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      var raw = parts[i].slice(eq + 1);
      var val;
      try { val = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (e) { continue; }
      if (val.indexOf('ssai') < 0) continue;
      var fixed = fixCapsString(val);
      if (fixed !== val) {
        parts[i] = parts[i].slice(0, eq + 1) + encodeURIComponent(fixed);
        changed = true;
      }
    }
    if (!changed) return url + hash;
    return url.slice(0, q + 1) + parts.join('&') + hash;
  }

  // ---------------------------------------------------------------------------
  // 2. Response sanitizing
  // ---------------------------------------------------------------------------
  function stripAdMeta(item) {
    // Player interventions look like { event_time_s, is_skippable, meta: { preroll|midroll|... } }
    var meta = item && item.meta;
    if (!meta || typeof meta !== 'object' || isArray(meta)) return false;
    var hit = false;
    for (var i = 0; i < AD_META_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(meta, AD_META_KEYS[i])) {
        delete meta[AD_META_KEYS[i]];
        hit = true;
      }
    }
    return hit;
  }

  function isEmptyObject(o) {
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return false;
    return true;
  }

  function templateMatches(item, re) {
    return (typeof item.template === 'string' && re.test(item.template)) ||
      (typeof item.widget_type === 'string' && re.test(item.widget_type));
  }

  function isAdWidget(item) {
    if (!item || typeof item !== 'object') return false;
    if (CONFIG.stripDisplayAds && templateMatches(item, AD_WIDGET_RE)) return true;
    if (CONFIG.hideUpgrade && templateMatches(item, NUDGE_WIDGET_RE)) return true;
    return false;
  }

  // Side-nav entry: { title: "Upgrade", default_icon, active_icon, actions, sub_items }
  function isUpgradeNavItem(item) {
    if (!CONFIG.hideUpgrade || !item || typeof item !== 'object') return false;
    if (typeof item.title !== 'string' || !UPGRADE_TITLE_RE.test(item.title)) return false;
    return 'default_icon' in item || 'active_icon' in item || 'actions' in item;
  }

  // Event intervention: { event_name: "DELAYED_PAUSE_FOR_ADS", meta: { compose_display: { add_widget ... } } }
  function isPauseAdIntervention(item) {
    if (!CONFIG.stripPauseAds || !item || typeof item !== 'object') return false;
    if (typeof item.event_name !== 'string') return false;
    if (/PAUSE/i.test(item.event_name) && /ADS?\b|_ADS?_/i.test(item.event_name)) return true;
    try {
      return !!item.meta && PAUSE_AD_RE.test(JSON.stringify(item.meta));
    } catch (e) {
      return false;
    }
  }

  // Returns true when something was changed.
  function sanitize(node, depth) {
    if (!node || typeof node !== 'object' || depth > 40) return false;
    var changed = false;

    if (isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        var item = node[i];
        if (isAdWidget(item) || isUpgradeNavItem(item) || isPauseAdIntervention(item)) {
          node.splice(i, 1); changed = true; continue;
        }
        if (CONFIG.stripInterventions && stripAdMeta(item)) {
          changed = true;
          if (isEmptyObject(item.meta)) { node.splice(i, 1); continue; }
        }
        if (sanitize(item, depth + 1)) changed = true;
      }
      return changed;
    }

    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      var v = node[k];
      if (CONFIG.stripSsai) {
        if ((k === 'ssai_tag' || k === 'ssaiTag') && typeof v === 'string' && v) {
          node[k] = ''; changed = true; continue;
        }
        if (k === 'live_stream_ad' && v) { node[k] = null; changed = true; continue; }
        // Remote config flag (Firebase entries are strings, defaults are booleans).
        if (k === 'web.playback.enableSSAI' && v !== false && v !== 'false') {
          node[k] = typeof v === 'string' ? 'false' : false; changed = true; continue;
        }
        if (k === 'client_capabilities' || k === 'clientCapabilities') {
          if (fixCaps(v)) { stats.caps++; changed = true; }
        }
      }
      if (v && typeof v === 'object' && sanitize(v, depth + 1)) changed = true;
    }
    return changed;
  }

  var EMPTY_VAST = '<?xml version="1.0" encoding="UTF-8"?><VAST version="4.0"></VAST>';
  var EMPTY_VMAP = '<?xml version="1.0" encoding="UTF-8"?><vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>';

  function adXmlReplacement(text) {
    if (!CONFIG.emptyVast || typeof text !== 'string') return null;
    var head = text.slice(0, 600);
    if (head.indexOf('<') < 0) return null;
    if (/<(\w+:)?VMAP[\s>]/.test(head)) return EMPTY_VMAP;
    if (/<VAST[\s>]/.test(head)) {
      // Already empty -> leave it alone.
      if (!/<Ad[\s>]/.test(text)) return null;
      return EMPTY_VAST;
    }
    return null;
  }

  // Transform a text response. Returns the new text or null when unchanged.
  function transformText(url, text) {
    if (typeof text !== 'string' || !text) return null;
    var c = text.charAt(0) === '﻿' ? text.charAt(1) : text.charAt(0);
    if (c === '<' || /^\s*</.test(text.slice(0, 64))) {
      var x = adXmlReplacement(text);
      if (x !== null) { stats.vast++; log('emptied ad XML from ' + url); }
      return x;
    }
    if ((c === '{' || c === '[') && isJsonTarget(url) && text.length < 8 * 1024 * 1024) {
      try {
        var obj = JSON.parse(text);
        if (sanitize(obj, 0)) { stats.json++; return JSON.stringify(obj); }
      } catch (e) {}
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // XMLHttpRequest hook
  // ---------------------------------------------------------------------------
  function hookXhr() {
    var X = window.XMLHttpRequest;
    if (!X || !X.prototype) return;
    var proto = X.prototype;
    var origOpen = proto.open;
    var origSend = proto.send;

    function protoGetter(name) {
      var d = Object.getOwnPropertyDescriptor(proto, name);
      return d && d.get ? d.get : null;
    }
    var getText = protoGetter('responseText');
    var getResp = protoGetter('response');
    var getType = protoGetter('responseType');
    var getState = protoGetter('readyState');
    var canPatch = !!(getText && getResp && getState);

    function done(xhr) {
      return (getState ? getState.call(xhr) : xhr.readyState) === 4;
    }

    function processed(xhr) {
      if (xhr.__hoDone) return xhr.__hoResult;
      if (!done(xhr)) return null;
      xhr.__hoDone = true;
      xhr.__hoResult = null;
      try {
        var type = getType ? getType.call(xhr) : xhr.responseType;
        if (type === '' || type === 'text') {
          xhr.__hoResult = { text: transformText(xhr.__hoUrl, getText.call(xhr)) };
        } else if (type === 'json') {
          var obj = getResp.call(xhr);
          if (obj && typeof obj === 'object' && isJsonTarget(xhr.__hoUrl) && sanitize(obj, 0)) stats.json++;
        }
      } catch (e) { log('xhr transform failed: ' + e); }
      return xhr.__hoResult;
    }

    function patchInstance(xhr) {
      if (!canPatch || xhr.__hoPatched) return;
      xhr.__hoPatched = true;
      try {
        Object.defineProperty(xhr, 'responseText', {
          configurable: true,
          get: function () {
            var r = processed(this);
            return r && r.text !== null ? r.text : getText.call(this);
          }
        });
        Object.defineProperty(xhr, 'response', {
          configurable: true,
          get: function () {
            var r = processed(this);
            return r && r.text !== null ? r.text : getResp.call(this);
          }
        });
      } catch (e) { log('cannot patch xhr: ' + e); }
    }

    proto.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      this.__hoUrl = String(url);
      this.__hoDone = false;
      if (isTelemetry(url)) {
        stats.blocked++;
        args[1] = 'https://127.0.0.1:9/hotsoff-blocked';
      } else {
        args[1] = rewriteUrl(String(url));
      }
      return origOpen.apply(this, args);
    };

    proto.send = function (body) {
      if (typeof body === 'string') body = fixCapsString(body);
      patchInstance(this);
      return origSend.call(this, body);
    };
  }

  // ---------------------------------------------------------------------------
  // fetch hook
  // ---------------------------------------------------------------------------
  function hookFetch() {
    var origFetch = window.fetch;
    if (typeof origFetch !== 'function' || typeof window.Response !== 'function') return;

    window.fetch = function (input, init) {
      var isReq = typeof window.Request === 'function' && input instanceof window.Request;
      var url = isReq ? input.url : String(input);

      if (isTelemetry(url)) {
        stats.blocked++;
        return Promise.resolve(new window.Response(null, { status: 204, statusText: 'No Content' }));
      }

      var newUrl = rewriteUrl(url);
      if (newUrl !== url) input = isReq ? new window.Request(newUrl, input) : newUrl;

      if (init && typeof init.body === 'string') {
        var b = fixCapsString(init.body);
        if (b !== init.body) {
          var copy = {};
          for (var k in init) copy[k] = init[k];
          copy.body = b;
          init = copy;
        }
      }

      return origFetch.call(this, input, init).then(function (res) {
        try {
          var ct = (res.headers && res.headers.get('content-type')) || '';
          var wanted = /json|xml|text\/plain/i.test(ct) || (!ct && isJsonTarget(url));
          if (!wanted || res.status === 204 || res.type === 'opaque') return res;
          return res.clone().text().then(function (text) {
            var out = transformText(url, text);
            if (out === null) return res;
            return new window.Response(out, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          }, function () { return res; });
        } catch (e) {
          return res;
        }
      });
    };
  }

  // ---------------------------------------------------------------------------
  // sendBeacon hook (telemetry)
  // ---------------------------------------------------------------------------
  function hookBeacon() {
    var nav = window.navigator;
    if (!nav || typeof nav.sendBeacon !== 'function') return;
    var orig = nav.sendBeacon;
    try {
      nav.sendBeacon = function (url) {
        if (isTelemetry(url)) { stats.blocked++; return true; }
        return orig.apply(nav, arguments);
      };
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Cached capabilities in storage (read on start before any request is made)
  // ---------------------------------------------------------------------------
  function fixStoredCaps() {
    var stores = [];
    try { stores.push(window.localStorage); } catch (e) {}
    try { stores.push(window.sessionStorage); } catch (e) {}
    for (var s = 0; s < stores.length; s++) {
      var st = stores[s];
      if (!st) continue;
      try {
        for (var i = 0; i < st.length; i++) {
          var key = st.key(i);
          var val = st.getItem(key);
          if (!val || val.indexOf('ssai') < 0 || val.indexOf('"ads"') < 0) continue;
          var fixed = fixCapsString(val);
          if (fixed !== val) st.setItem(key, fixed);
        }
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // CSS fallback for the pause-ad overlay (not focusable, safe to hide)
  // ---------------------------------------------------------------------------
  function injectCss() {
    if (!CONFIG.stripPauseAds) return;
    var css =
      '[data-testid="pause-ad-skin-container"],' +
      '.PAUSE_AD_BACKGROUND_GRADIENT' +
      '{display:none!important;visibility:hidden!important;opacity:0!important}';
    var add = function () {
      var root = document.head || document.documentElement;
      if (!root) return false;
      var el = document.createElement('style');
      el.id = 'hotsoff-style';
      el.appendChild(document.createTextNode(css));
      root.appendChild(el);
      return true;
    };
    if (!add()) document.addEventListener('DOMContentLoaded', add);
    // Re-add if the app replaces <head> content.
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.getElementById('hotsoff-style')) add();
    });
  }

  // ---------------------------------------------------------------------------
  // Toast so the user can see the patch is active
  // ---------------------------------------------------------------------------
  function toast() {
    if (!CONFIG.toast) return;
    try {
      if (window.sessionStorage.getItem('__hotsoff_toast')) return;
      window.sessionStorage.setItem('__hotsoff_toast', '1');
    } catch (e) {}
    try {
      if (typeof window.PalmServiceBridge !== 'function') return;
      var bridge = new window.PalmServiceBridge();
      bridge.onservicecallback = function () {};
      bridge.call('luna://com.webos.notification/createToast',
        JSON.stringify({ message: 'HotsOff loaded', noaction: true }));
      window.__HOTSOFF__.bridge = bridge; // keep a reference until the call returns
    } catch (e) {}
  }

  // Exposed for debugging (ares-inspect) and tests.
  window.__HOTSOFF__.internal = {
    rewriteUrl: rewriteUrl,
    fixCapsString: fixCapsString,
    sanitize: sanitize,
    isPauseAdIntervention: isPauseAdIntervention,
    isUpgradeNavItem: isUpgradeNavItem,
    transformText: transformText
  };

  try { hookXhr(); } catch (e) { log('xhr hook failed: ' + e); }
  try { hookFetch(); } catch (e) { log('fetch hook failed: ' + e); }
  try { hookBeacon(); } catch (e) {}
  try { fixStoredCaps(); } catch (e) {}
  try { injectCss(); } catch (e) {}
  try { toast(); } catch (e) {}
  log('active v' + VERSION);
})();
