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

  function load() {
    if (ready) return ready;
    ready = new Promise(function (resolve, reject) {
      frame = document.createElement('iframe');
      frame.src = NOVA_URL; frame.title = 'Nova brain'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
      var t0 = Date.now();
      function poll() {
        var w = null;
        try { w = frame.contentWindow; } catch (e) { w = null; }
        var ok = false;
        try { ok = !!(w && w.document && w.document.readyState !== 'loading' && typeof w.send === 'function' && w.NovaTrain && w.eval('typeof state') === 'object'); } catch (e) { ok = false; }
        if (ok) return resolve(w);
        if (Date.now() - t0 > 20000) { ready = null; return reject(new Error('Nova did not load')); }
        setTimeout(poll, 100);
      }
      frame.addEventListener('load', poll);
      document.body.appendChild(frame);
    });
    return ready;
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
      var fn = w.eval(ASK_SRC);
      return fn(String(text));
    });
  }

  root.NovaBridge = { load: load, ask: ask, url: NOVA_URL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
