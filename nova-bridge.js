/*
 * Jarvis Phone - bridge to Nova. Loads the live Nova app (same origin, /Nova-AI/) in a hidden
 * frame and sends each line through Nova's own send()/reply() path, so math, word problems,
 * facts, lessons, owner commands and the teach-on-"i do not know" flow are all Nova's code.
 * Jarvis keeps its lines in a separate "Jarvis voice" chat inside Nova.
 */
(function (root) {
  'use strict';
  var NOVA_URL = root.JARVIS_NOVA_URL || '/Nova-AI/?embed=jarvis';
  var frame = null, ready = null;

  var LOAD_MS = 20000;
  function alive(w) {
    try { return !!(w && w.document && w.document.readyState !== 'loading' && typeof w.send === 'function' && w.NovaTrain && w.eval('typeof state') === 'object'); } catch (e) { return false; }
  }
  // Throw away the frame and start again (used after the app comes back from the background).
  function reset() {
    ready = null;
    if (frame && frame.parentNode) { try { frame.parentNode.removeChild(frame); } catch (e) { /* ignore */ } }
    frame = null;
  }
  function load() {
    if (ready) return ready;
    var p = new Promise(function (resolve, reject) {
      frame = document.createElement('iframe');
      frame.src = NOVA_URL; frame.title = 'Nova brain'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
      var t0 = Date.now(), f = frame, settled = false;
      // Poll from the start (not only after the load event, which may never fire if a Nova file hangs),
      // and always give up after LOAD_MS so the user gets a message instead of silence.
      function poll() {
        if (settled) return;
        var w = null;
        try { w = f.contentWindow; } catch (e) { w = null; }
        if (alive(w)) { settled = true; return resolve(w); }
        if (Date.now() - t0 > LOAD_MS) { settled = true; if (ready === p) ready = null; return reject(new Error('Nova did not load')); }
        setTimeout(poll, 150);
      }
      document.body.appendChild(f);
      setTimeout(poll, 150);
    });
    ready = p;
    return p;
  }
  // Is the loaded Nova frame still usable? Reloads it when not. Resolves true/false within ~ms.
  function check() {
    if (!ready || !frame) return Promise.resolve(false);
    var w = null; try { w = frame.contentWindow; } catch (e) { w = null; }
    if (alive(w) && document.body.contains(frame)) return Promise.resolve(true);
    reset(); load().catch(function () { /* surfaced on the next ask */ });
    return Promise.resolve(false);
  }
  // Runs inside Nova's window (global scope) so Nova's own state/currentChat/send/save are used.
  var ASK_SRC = '(function(line){' +
    'var prev=state.currentId, chat=null;' +
    'for(var i=0;i<state.conversations.length;i++){if(state.conversations[i].jarvis){chat=state.conversations[i];break;}}' +
    'if(!chat){chat=makeChat("Jarvis voice");chat.jarvis=true;state.conversations.push(chat);}' +
    'state.currentId=chat.id;' +
    'try{send(line);}finally{if(prev&&prev!==chat.id){state.currentId=prev;}save();}' +
    'var m=chat.messages[chat.messages.length-1];' +
    'return m&&m.role==="assistant"?String(m.content):"";' +
    '})';

  function ask(text) {
    return load().then(function (w) {
      if (!alive(w)) { reset(); return load(); }
      return w;
    }).then(function (w) {
      var fn = w.eval(ASK_SRC);
      return fn(String(text));
    });
  }

  root.NovaBridge = { load: load, ask: ask, check: check, reset: reset, url: NOVA_URL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
