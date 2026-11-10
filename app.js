(function(){
  var store = {
    get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},
    set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  };
  var dsCore = store.get("dsCore") || "desmume2015";
  var segBtns = document.querySelectorAll("#dsCore button");
  function paintSeg(){ segBtns.forEach(function(b){ b.classList.toggle("on", b.dataset.core===dsCore); }); }
  segBtns.forEach(function(b){ b.addEventListener("click", function(){ dsCore=b.dataset.core; store.set("dsCore",dsCore); paintSeg(); }); });
  paintSeg();

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  var gfx = store.get("gfx") || (isIOS ? "compat" : "modern");
  var gfxBtns = document.querySelectorAll("#gfx button");
  function paintGfx(){ gfxBtns.forEach(function(b){ b.classList.toggle("on", b.dataset.gfx===gfx); }); }
  gfxBtns.forEach(function(b){ b.addEventListener("click", function(){ gfx=b.dataset.gfx; store.set("gfx",gfx); paintGfx(); }); });
  paintGfx();

  var fileInput = document.getElementById("file");
  var pickedSys = null;
  document.querySelectorAll(".card").forEach(function(c){
    c.addEventListener("click", function(){ pickedSys = c.dataset.sys; fileInput.value=""; fileInput.click(); });
  });
  fileInput.addEventListener("change", function(){ if(fileInput.files[0]) start(fileInput.files[0], pickedSys); });

  var drop = document.getElementById("drop");
  ["dragenter","dragover"].forEach(function(ev){ drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add("over");}); });
  ["dragleave","drop"].forEach(function(ev){ drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove("over");}); });
  drop.addEventListener("drop", function(e){ var f=e.dataTransfer.files[0]; if(f) start(f, null); });

  function showErr(msg){ var el=document.getElementById("err"); el.textContent=msg; el.className=""; el.style.display="block"; el.scrollIntoView({block:"nearest"}); }
  function showOk(msg){ var el=document.getElementById("err"); el.textContent=msg; el.className="ok"; el.style.display="block"; el.scrollIntoView({block:"nearest"}); }

  function sysFromName(name){
    var ext = (name.split(".").pop()||"").toLowerCase();
    if (["gba","gb","gbc","agb","sgb"].indexOf(ext)>=0) return "gba";
    if (["nds","dsi","srl"].indexOf(ext)>=0) return "nds";
    if (["zip","7z","rar"].indexOf(ext)>=0) return "archive";
    return null;
  }

  // Para .zip sin tarjeta elegida: busca el nombre del archivo interno en la cabecera ZIP
  function guessFromZip(file){
    return file.slice(0, Math.min(file.size, 4096)).arrayBuffer().then(function(buf){
      var txt = new TextDecoder("latin1").decode(new Uint8Array(buf)).toLowerCase();
      if (/\.nds/.test(txt)) return "nds";
      if (/\.gb[ac]?/.test(txt)) return "gba";
      return null;
    }).catch(function(){ return null; });
  }

  /* ---------- Biblioteca: los juegos se guardan en este navegador para abrirlos con un toque ---------- */
  var Recent = (function(){
    var DB = "emu-recientes", dbp = null;
    function db(){
      if (dbp) return dbp;
      dbp = new Promise(function(res, rej){
        try {
          var r = indexedDB.open(DB, 3);
          r.onupgradeneeded = function(){
            var d=r.result;
            if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta",{keyPath:"id"});
            if (!d.objectStoreNames.contains("roms")) d.createObjectStore("roms");
            if (!d.objectStoreNames.contains("states")) d.createObjectStore("states");   // "continuar donde lo dejaste"
            if (!d.objectStoreNames.contains("slots")) d.createObjectStore("slots");     // guardado rápido: "<id>#<n>"
          };
          r.onsuccess = function(){ res(r.result); };
          r.onerror = function(){ rej(r.error); };
        } catch(e){ rej(e); }
      });
      return dbp;
    }
    function tx(stores, mode, fn){
      return db().then(function(d){ return new Promise(function(res, rej){
        var t = d.transaction(stores, mode), out = fn(t);
        t.oncomplete = function(){ res(out && typeof IDBRequest !== "undefined" && out instanceof IDBRequest ? out.result : out); };
        t.onerror = t.onabort = function(){ rej(t.error); };
      }); });
    }
    function list(){
      return tx(["meta"], "readonly", function(t){ return t.objectStore("meta").getAll(); })
        .then(function(a){ return (a||[]).sort(function(x,y){ return ((y.fav?1:0) - (x.fav?1:0)) || (y.last - x.last); }); })
        .catch(function(){ return []; });
    }
    // Ya no se borra ningún juego automáticamente: la biblioteca la gestionas tú
    function save(file, sys, gameName){
      var id = gameId(file, sys);
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
      return tx(["meta","roms"], "readwrite", function(t){
        var meta = t.objectStore("meta"), roms = t.objectStore("roms"), g = meta.get(id), c = roms.count(id);
        g.onsuccess = function(){
          var prev = g.result || {};
          meta.put(Object.assign({}, prev, {id:id, name:file.name, sys:sys, size:file.size, last:Date.now(), gameName:gameName}));
        };
        c.onsuccess = function(){ if (!c.result) roms.put(file.slice(0, file.size, file.type || "application/octet-stream"), id); };
      }).catch(function(){ toast("No hay espacio para guardar el juego en la biblioteca", 3500); });
    }
    function get(id){ return tx(["roms"], "readonly", function(t){ return t.objectStore("roms").get(id); }); }
    function update(id, fn){
      return tx(["meta"], "readwrite", function(t){
        var st = t.objectStore("meta"), g = st.get(id);
        g.onsuccess = function(){ if (g.result){ fn(g.result); st.put(g.result); } };
      });
    }
    function remove(id){
      return tx(["meta","roms","states","slots"], "readwrite", function(t){
        ["meta","roms","states"].forEach(function(n){ t.objectStore(n).delete(id); });
        t.objectStore("slots").delete(IDBKeyRange.bound(id + "#", id + "#￿"));
      });
    }
    function clearExtras(id){
      return tx(["states","slots"], "readwrite", function(t){
        t.objectStore("states").delete(id);
        t.objectStore("slots").delete(IDBKeyRange.bound(id + "#", id + "#￿"));
      });
    }
    function setThumb(id, blob){ return update(id, function(r){ r.thumb = blob; }); }
    function addTime(id, secs){ return update(id, function(r){ r.playTime = (r.playTime || 0) + secs; }); }
    function putState(id, blob){ return tx(["states"], "readwrite", function(t){ t.objectStore("states").put({blob:blob, ts:Date.now()}, id); }); }
    function getState(id){ return tx(["states"], "readonly", function(t){ return t.objectStore("states").get(id); }); }
    function putSlot(id, n, rec){ return tx(["slots"], "readwrite", function(t){ t.objectStore("slots").put(rec, id + "#" + n); }); }
    function getSlot(id, n){ return tx(["slots"], "readonly", function(t){ return t.objectStore("slots").get(id + "#" + n); }); }
    // Lo que ocupa cada juego: copia del juego, "continuar" y ranuras
    function sizes(){
      var out = {};
      function add(id, k, n){ out[id] = out[id] || {rom:0, extra:0}; out[id][k] += n || 0; }
      return tx(["roms","states","slots"], "readonly", function(t){
        t.objectStore("roms").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return; add(c.key, "rom", c.value && c.value.size); c.continue(); };
        t.objectStore("states").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return; add(c.key, "extra", c.value && c.value.blob && c.value.blob.size); c.continue(); };
        t.objectStore("slots").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return;
          add(String(c.key).replace(/#\d+$/, ""), "extra", (c.value && c.value.blob ? c.value.blob.size : 0) + (c.value && c.value.thumb ? c.value.thumb.size : 0)); c.continue(); };
      }).then(function(){ return out; }).catch(function(){ return out; });
    }
    // Para la copia de seguridad completa (todo menos las copias de los juegos)
    function dumpExtras(){
      var out = {meta:[], states:[], slots:[]};
      return tx(["meta","states","slots"], "readonly", function(t){
        t.objectStore("meta").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return; out.meta.push(c.value); c.continue(); };
        t.objectStore("states").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return; out.states.push({id:c.key, ts:c.value.ts, blob:c.value.blob}); c.continue(); };
        t.objectStore("slots").openCursor().onsuccess = function(e){ var c = e.target.result; if (!c) return; out.slots.push({key:c.key, ts:c.value.ts, blob:c.value.blob, thumb:c.value.thumb}); c.continue(); };
      }).then(function(){ return out; });
    }
    function loadExtras(d){
      return tx(["meta","states","slots"], "readwrite", function(t){
        var meta = t.objectStore("meta");
        (d.meta || []).forEach(function(m){
          var g = meta.get(m.id);
          g.onsuccess = function(){ meta.put(Object.assign({}, m, g.result ? {playTime: Math.max(g.result.playTime||0, m.playTime||0), last: Math.max(g.result.last||0, m.last||0)} : {})); };
        });
        (d.states || []).forEach(function(s){ t.objectStore("states").put({blob:s.blob, ts:s.ts}, s.id); });
        (d.slots || []).forEach(function(s){ t.objectStore("slots").put({blob:s.blob, ts:s.ts, thumb:s.thumb}, s.key); });
      });
    }
    return {list:list, save:save, get:get, remove:remove, clearExtras:clearExtras, putState:putState, getState:getState,
            setThumb:setThumb, addTime:addTime, update:update, putSlot:putSlot, getSlot:getSlot, sizes:sizes, dumpExtras:dumpExtras, loadExtras:loadExtras};
  })();

  function gameId(file, sys){ return sys + ":" + file.name + ":" + file.size; }

  function ago(ts){
    var m = Math.round((Date.now()-ts)/60000);
    if (m < 1) return "ahora mismo"; if (m < 60) return "hace " + m + " min";
    var h = Math.round(m/60); if (h < 24) return "hace " + h + " h";
    var d = Math.round(h/24); return d === 1 ? "ayer" : "hace " + d + " días";
  }
  function mb(b){ return b >= 1048576 ? (b >= 104857600 ? Math.round(b/1048576) : (b/1048576).toFixed(1).replace(".0","")) + " MB" : Math.max(1, Math.round(b/1024)) + " KB"; }
  function dur(secs){
    var m = Math.floor((secs||0) / 60), h = Math.floor(m / 60);
    return h ? h + " h " + (m % 60) + " min" : m ? m + " min" : "menos de 1 min";
  }

  // Carátula oficial (libretro-thumbnails) a partir del nombre estándar del archivo
  function artUrl(it){
    var ext = (it.name.split(".").pop() || "").toLowerCase();
    var sys = it.sys === "nds" ? "Nintendo_-_Nintendo_DS" : ext === "gb" ? "Nintendo_-_Game_Boy" : ext === "gbc" ? "Nintendo_-_Game_Boy_Color" : "Nintendo_-_Game_Boy_Advance";
    var base = it.name.replace(/\.[^.]+$/, "").replace(/[&*\/:`<>?\\|"]/g, "_");
    return "https://raw.githubusercontent.com/libretro-thumbnails/" + sys + "/master/Named_Boxarts/" + encodeURIComponent(base) + ".png";
  }

  var libQuery = "", libUrls = [];
  function renderRecent(){
    Promise.all([Recent.list(), Recent.sizes()]).then(function(r){
      var items = r[0], sz = r[1];
      var box = document.getElementById("recent"), ul = document.getElementById("rlist");
      libUrls.forEach(function(u){ URL.revokeObjectURL(u); }); libUrls = [];
      ul.innerHTML = "";
      box.classList.toggle("has", items.length > 0);
      document.getElementById("libSearch").style.display = items.length > 5 ? "" : "none";
      var q = libQuery.trim().toLowerCase();
      var shown = items.filter(function(it){ return !q || it.name.toLowerCase().indexOf(q) >= 0; });
      if (!shown.length && items.length){ ul.innerHTML = '<div class="empty">Ningún juego coincide con la búsqueda</div>'; }
      shown.forEach(function(it){
        var s = sz[it.id] || {rom:0, extra:0}, hasRom = s.rom > 0;
        var b = document.createElement("div"); b.className = "ri" + (hasRom ? "" : " norom"); b.setAttribute("role","button");
        var label = it.sys==="gba" ? "GBA" : "NDS";
        b.innerHTML = '<div class="tag '+it.sys+'"><b>'+label+'</b></div><div class="txt"><div class="nm"></div><div class="mt"></div></div>' +
          '<div class="fav'+(it.fav?' on':'')+'" aria-label="Favorito">★</div><div class="more" aria-label="Opciones">⋯</div>';
        b.querySelector(".nm").textContent = it.name.replace(/\.[^.]+$/, "");
        var meta = [it.playTime ? dur(it.playTime) + " jugado" : null, ago(it.last), mb(s.rom + s.extra)].filter(Boolean).join(" · ");
        b.querySelector(".mt").textContent = hasRom ? meta : "Falta el juego: tócalo para buscarlo en Archivos";
        // carátula oficial; si no hay, la última captura; si no, la etiqueta
        var tag = b.querySelector(".tag"), img = new Image();
        img.alt = ""; img.crossOrigin = "anonymous"; img.onload = function(){ tag.classList.add("art"); tag.appendChild(img); };
        img.onerror = function(){
          if (!it.thumb) return;
          var u = URL.createObjectURL(it.thumb); libUrls.push(u);
          var im2 = new Image(); im2.onload = function(){ tag.classList.add("shot"); tag.appendChild(im2); }; im2.src = u;
        };
        img.src = artUrl(it);
        b.addEventListener("click", function(e){
          if (e.target.closest(".fav")){ Recent.update(it.id, function(r){ r.fav = !r.fav; }).then(renderRecent); return; }
          if (e.target.closest(".more")){ openGameSheet(it, s); return; }
          if (!hasRom){ pickedSys = it.sys; fileInput.value = ""; fileInput.click(); return; }
          b.classList.add("loading"); b.querySelector(".mt").textContent = "Cargando…";
          Recent.get(it.id).then(function(blob){
            if (!blob){ b.classList.remove("loading"); showErr("No he encontrado ese juego guardado. Ábrelo de nuevo desde Archivos."); return; }
            launch(new File([blob], it.name), it.sys);
          }).catch(function(){ b.classList.remove("loading"); showErr("No se pudo abrir. Ábrelo de nuevo desde Archivos."); });
        });
        ul.appendChild(b);
      });
      renderStorage(items, sz);
    });
  }
  function renderStorage(items, sz){
    var total = 0; Object.keys(sz).forEach(function(k){ total += sz[k].rom + sz[k].extra; });
    var elx = document.getElementById("libStore");
    var txt = items.length + (items.length === 1 ? " juego" : " juegos") + " · " + mb(total);
    elx.textContent = txt;
    try {
      navigator.storage.estimate().then(function(e){
        if (!e || !e.quota) return;
        var free = e.quota - e.usage;
        elx.textContent = txt + " · quedan " + mb(free);
        elx.classList.toggle("warn", free < 300 * 1048576);
      });
    } catch(e){}
  }
  document.getElementById("libSearch").addEventListener("input", function(){ libQuery = this.value; renderRecent(); });

  // Opciones de cada juego (⋯)
  function openGameSheet(it, s){
    var w = document.getElementById("gameSheet");
    document.getElementById("gsName").textContent = it.name.replace(/\.[^.]+$/, "");
    document.getElementById("gsInfo").textContent = [it.sys === "gba" ? "Game Boy Advance" : "Nintendo DS",
      it.playTime ? "Jugado " + dur(it.playTime) : "Sin tiempo de juego registrado",
      "Copia del juego: " + mb(s.rom), "Guardados rápidos y continuar: " + mb(s.extra)].join("\n");
    document.getElementById("gsFav").textContent = it.fav ? "Quitar de favoritos" : "Marcar como favorito";
    document.getElementById("gsFav").onclick = function(){ Recent.update(it.id, function(r){ r.fav = !r.fav; }).then(function(){ w.classList.remove("show"); renderRecent(); }); };
    var armedX = false, armedR = false;
    document.getElementById("gsExtras").textContent = "Borrar guardados rápidos y continuar (" + mb(s.extra) + ")";
    document.getElementById("gsExtras").onclick = function(){
      if (!armedX){ armedX = true; this.textContent = "Toca otra vez para borrarlos"; return; }
      Recent.clearExtras(it.id).then(function(){ w.classList.remove("show"); renderRecent(); showOk("Guardados rápidos borrados. La partida del juego se conserva."); });
    };
    document.getElementById("gsRemove").textContent = "Quitar de la biblioteca";
    document.getElementById("gsRemove").onclick = function(){
      if (!armedR){ armedR = true; this.textContent = "Toca otra vez: se borra la copia del juego y sus guardados rápidos"; return; }
      Recent.remove(it.id).then(function(){ w.classList.remove("show"); renderRecent(); showOk("Juego quitado. Su partida guardada se conserva por si lo vuelves a abrir."); });
    };
    w.classList.add("show");
  }
  document.getElementById("gameSheet").addEventListener("click", function(e){ if (e.target === this || e.target.closest("[data-close]")) this.classList.remove("show"); });

  // Aviso para usar la app de la pantalla de inicio (en Safari, iOS puede borrar los datos tras 7 días sin uso)
  (function(){
    var standalone = navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
    if (ios && !standalone && !store.get("pwaTipHidden")){
      var t = document.getElementById("pwaTip"); t.style.display = "";
      document.getElementById("pwaTipOk").onclick = function(){ t.style.display = "none"; store.set("pwaTipHidden", "1"); };
    }
  })();

  // Borrar una vez las copias duplicadas que guardaba EmulatorJS (juegos y motores en caché)
  if (!store.get("ejsCachePurged")){
    try {
      ["EmulatorJS-roms", "EmulatorJS-bios", "EmulatorJS-core"].forEach(function(n){ indexedDB.deleteDatabase(n); });
      store.set("ejsCachePurged", "1");
      setTimeout(renderRecent, 1500);       // para que el espacio libre se actualice
    } catch(e){}
  }

  renderRecent();

  /* ---------- Copia de seguridad de las partidas del juego (las guarda EmulatorJS en IndexedDB "/data/saves") ---------- */
  var Backup = (function(){
    var DBN = "/data/saves", STORE = "FILE_DATA", PREFIX = "/data/saves/";
    function openRaw(version){
      return new Promise(function(res, rej){
        var r = version ? indexedDB.open(DBN, version) : indexedDB.open(DBN);
        r.onupgradeneeded = function(){      // igual que lo crea Emscripten (IDBFS)
          var d = r.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE).createIndex("timestamp", "timestamp", {unique:false});
        };
        r.onsuccess = function(){ res(r.result); };
        r.onerror = function(){ rej(r.error); };
      });
    }
    function openDb(create){
      return openRaw().then(function(d){
        if (!create || d.objectStoreNames.contains(STORE)) return d;
        var v = d.version + 1; d.close(); return openRaw(v);
      });
    }
    function readAll(){
      return openDb(false).then(function(d){
        return new Promise(function(res, rej){
          if (!d.objectStoreNames.contains(STORE)){ d.close(); return res([]); }
          var out = [], t = d.transaction(STORE, "readonly"), c = t.objectStore(STORE).openCursor();
          c.onsuccess = function(){
            var cur = c.result; if (!cur) return;
            var v = cur.value, k = String(cur.key);
            if (v && v.contents && k.indexOf(PREFIX) === 0) out.push({name: k.slice(PREFIX.length), data: new Uint8Array(v.contents)});
            cur.continue();
          };
          t.oncomplete = function(){ d.close(); res(out); };
          t.onerror = function(){ d.close(); rej(t.error); };
        });
      });
    }
    function writeAll(entries){
      return openDb(true).then(function(d){
        return new Promise(function(res, rej){
          var t = d.transaction(STORE, "readwrite"), st = t.objectStore(STORE), now = new Date();
          entries.forEach(function(e){
            var parts = e.name.split("/"), acc = PREFIX.slice(0, -1);
            for (var i = 0; i < parts.length - 1; i++){ acc += "/" + parts[i]; st.put({timestamp: now, mode: 16893}, acc); }
            st.put({timestamp: now, mode: 33206, contents: e.data}, PREFIX + e.name);
          });
          t.oncomplete = function(){ d.close(); res(entries.length); };
          t.onerror = function(){ d.close(); rej(t.error); };
        });
      });
    }
    // ZIP mínimo sin compresión (se abre en Archivos de iOS, Windows, macOS…)
    var CRC = (function(){ var t = new Uint32Array(256); for (var n=0;n<256;n++){ var c=n; for (var k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
    function crc32(u8){ var c = 0xFFFFFFFF; for (var i=0;i<u8.length;i++) c = CRC[(c^u8[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
    // CRC32 leyendo por trozos de 2 MB: así no hace falta tener todo el archivo en memoria
    function crcOf(src){
      if (!(src instanceof Blob)) return Promise.resolve(crc32(src));
      var c = 0xFFFFFFFF, pos = 0, CH = 2097152;
      function step(){
        if (pos >= src.size) return Promise.resolve((c ^ 0xFFFFFFFF) >>> 0);
        return src.slice(pos, pos + CH).arrayBuffer().then(function(b){
          var u = new Uint8Array(b); for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8);
          pos += CH; return step();
        });
      }
      return step();
    }
    // entries: {name, data: Uint8Array | Blob}. El resultado es un Blob hecho de trozos (no copia los datos grandes).
    function zip(entries){
      var enc = new TextEncoder(), parts = [], central = [], off = 0, i = 0;
      function next(){
        if (i >= entries.length){
          var csize = central.reduce(function(a,b){ return a + b.byteLength; }, 0);
          var end = new DataView(new ArrayBuffer(22));
          end.setUint32(0,0x06054b50,true); end.setUint16(8,entries.length,true); end.setUint16(10,entries.length,true);
          end.setUint32(12,csize,true); end.setUint32(16,off,true);
          return Promise.resolve(new Blob(parts.concat(central, [end.buffer]), {type:"application/zip"}));
        }
        var e = entries[i++], data = e.data, sz = data instanceof Blob ? data.size : data.length;
        return crcOf(data).then(function(crc){
          var nm = enc.encode(e.name);
          var h = new DataView(new ArrayBuffer(30));
          h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
          h.setUint32(14,crc,true); h.setUint32(18,sz,true); h.setUint32(22,sz,true); h.setUint16(26,nm.length,true);
          parts.push(h.buffer, nm, data);
          var c = new DataView(new ArrayBuffer(46));
          c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true);
          c.setUint32(16,crc,true); c.setUint32(20,sz,true); c.setUint32(24,sz,true); c.setUint16(28,nm.length,true); c.setUint32(42,off,true);
          central.push(c.buffer, nm);
          off += 30 + nm.length + sz;
          return next();
        });
      }
      return next();
    }
    function inflate(blob){
      if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("deflate"));
      return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    }
    // Lee el índice del .zip y devuelve cada archivo como un trozo (Blob) del original, sin cargarlo entero
    function unzip(file){
      var dec = new TextDecoder(), tailStart = Math.max(0, file.size - 66000);
      return file.slice(tailStart).arrayBuffer().then(function(tb){
        var dv = new DataView(tb), eocd = -1;
        for (var i = tb.byteLength - 22; i >= 0; i--) if (dv.getUint32(i,true) === 0x06054b50){ eocd = i; break; }
        if (eocd < 0) throw new Error("zip");
        var n = dv.getUint16(eocd+10,true), csize = dv.getUint32(eocd+12,true), coff = dv.getUint32(eocd+16,true);
        return file.slice(coff, coff + csize).arrayBuffer().then(function(cb){
          var cd = new DataView(cb), cu = new Uint8Array(cb), p = 0, list = [];
          for (var k = 0; k < n; k++){
            var method = cd.getUint16(p+10,true), csz = cd.getUint32(p+20,true), nl = cd.getUint16(p+28,true), xl = cd.getUint16(p+30,true), cl = cd.getUint16(p+32,true), lo = cd.getUint32(p+42,true);
            var name = dec.decode(cu.subarray(p+46, p+46+nl));
            p += 46 + nl + xl + cl;
            if (name.endsWith("/") || name.indexOf("..") >= 0 || name.indexOf("__MACOSX") === 0 || /(^|\/)\./.test(name)) continue;
            list.push({name: name.replace(/^\/+/, ""), method: method, csz: csz, lo: lo});
          }
          // cada entrada: leer su cabecera local para saber dónde empiezan los datos
          return Promise.all(list.map(function(e){
            return file.slice(e.lo, e.lo + 30).arrayBuffer().then(function(hb){
              var hv = new DataView(hb), start = e.lo + 30 + hv.getUint16(26,true) + hv.getUint16(28,true), raw = file.slice(start, start + e.csz);
              if (e.method === 0) return {name: e.name, blob: raw};
              if (e.method === 8) return inflate(raw).then(function(b){ return {name: e.name, blob: b}; });
              throw new Error("método");
            });
          }));
        });
      });
    }
    // Copia completa: partidas del juego + guardados rápidos, "continuar", biblioteca y ajustes (sin las copias de los juegos)
    function u8(blob){ return blob ? blob.arrayBuffer().then(function(b){ return new Uint8Array(b); }) : Promise.resolve(null); }
    function buildZip(full){
      return Promise.all([readAll(), Recent.dumpExtras()]).then(function(r){
        var entries = r[0], x = r[1], files = [], jobs = [];
        var man = {formato: "emulador-gba-nds", version: 1, fecha: new Date().toISOString(), prefs: prefs, meta: [], states: [], slots: []};
        x.meta.forEach(function(m, i){
          var mm = Object.assign({}, m); delete mm.thumb;
          if (m.thumb){ mm.thumbFile = "_emulador/capturas/" + i + ".png"; files.push({name: mm.thumbFile, data: m.thumb}); }
          man.meta.push(mm);
        });
        if (full){
          x.states.forEach(function(st, i){
            var f = "_emulador/continuar/" + i + ".bin"; man.states.push({id: st.id, ts: st.ts, file: f});
            files.push({name: f, data: st.blob});
          });
          x.slots.forEach(function(sl, i){
            var f = "_emulador/ranuras/" + i + ".bin", t = sl.thumb ? "_emulador/ranuras/" + i + ".png" : null;
            man.slots.push({key: sl.key, ts: sl.ts, file: f, thumb: t});
            files.push({name: f, data: sl.blob});
            if (t) files.push({name: t, data: sl.thumb});
          });
        }
        return Promise.all(jobs).then(function(){
          if (!entries.length && !man.meta.length) return null;
          files.push({name: "_emulador/datos.json", data: new TextEncoder().encode(JSON.stringify(man))});
          var d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
          return zip(entries.concat(files)).then(function(z){ return new File([z], "copia-emulador-" + (full ? "" : "partidas-") + stamp + ".zip", {type:"application/zip"}); });
        });
      });
    }
    var ready = null;
    function share(file){
      if (navigator.canShare && navigator.canShare({files:[file]})){
        return navigator.share({files:[file], title:"Copia del emulador"}).then(function(){ ready = null; resetBtn(); }).catch(function(e){
          if (e && e.name === "NotAllowedError"){        // iOS: compartir necesita un toque reciente
            ready = file; var b = document.getElementById("bkExport"); b.firstChild.nodeValue = "Compartir copia"; showOk("Copia preparada (" + mb(file.size) + "). Toca «Compartir copia».");
          } else if (!e || e.name !== "AbortError"){ download(file); }
        });
      }
      download(file); return Promise.resolve();
    }
    function resetBtn(){ var b = document.getElementById("bkExport"); b.firstChild.nodeValue = "Hacer copia"; }
    function exportAll(){
      if (ready) return share(ready);
      var full = !document.getElementById("bkLite").classList.contains("on");
      var b = document.getElementById("bkExport"); b.firstChild.nodeValue = "Preparando…";
      return buildZip(full).then(function(file){
        resetBtn();
        if (!file){ showErr("Todavía no hay partidas ni juegos que copiar."); return; }
        return share(file);
      });
    }
    function download(file){
      var a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }
    function importZip(file){
      return unzip(file).then(function(entries){
        if (!entries.length) throw new Error("vacío");
        var saveEntries = [], extra = {};
        entries.forEach(function(e){ if (e.name.indexOf("_emulador/") === 0) extra[e.name] = e.blob; else saveEntries.push(e); });
        // las partidas del juego son pequeñas: se leen a memoria para escribirlas donde las busca el emulador
        var savesP = Promise.all(saveEntries.map(function(e){ return e.blob.arrayBuffer().then(function(b){ return {name: e.name, data: new Uint8Array(b)}; }); }));
        var manP = extra["_emulador/datos.json"] ? extra["_emulador/datos.json"].text().then(function(t){ try { return JSON.parse(t); } catch(e){ return null; } }) : Promise.resolve(null);
        return Promise.all([savesP, manP]).then(function(r){
          var saves = r[0], man = r[1];
          var blob = function(f, type){ return f && extra[f] ? (type ? new Blob([extra[f]], {type: type}) : extra[f]) : undefined; };
          var steps = [saves.length ? writeAll(saves) : Promise.resolve(0)];
          if (man){
            steps.push(Recent.loadExtras({
              meta: (man.meta || []).map(function(m){ var mm = Object.assign({}, m); mm.thumb = blob(m.thumbFile, "image/png"); delete mm.thumbFile; return mm; }),
              states: (man.states || []).filter(function(st){ return extra[st.file]; }).map(function(st){ return {id: st.id, ts: st.ts, blob: new Blob([extra[st.file]])}; }),
              slots: (man.slots || []).filter(function(sl){ return extra[sl.file]; }).map(function(sl){ return {key: sl.key, ts: sl.ts, blob: new Blob([extra[sl.file]]), thumb: blob(sl.thumb, "image/png")}; })
            }));
            if (man.prefs){ prefs = Object.assign({}, PREF_DEF, man.prefs); savePrefs(); }
          }
          return Promise.all(steps).then(function(){ return {saves: saves.length, games: man ? (man.meta || []).length : 0}; });
        });
      });
    }
    return {exportAll:exportAll, importZip:importZip, readAll:readAll};
  })();

  document.getElementById("bkExport").addEventListener("click", function(){
    Backup.exportAll().catch(function(){ showErr("No se pudo hacer la copia."); });
  });
  document.getElementById("bkLite").addEventListener("click", function(){ this.classList.toggle("on"); });
  document.getElementById("bkImport").addEventListener("click", function(){ var f = document.getElementById("bkFile"); f.value = ""; f.click(); });
  document.getElementById("bkFile").addEventListener("change", function(){
    var f = this.files[0]; if (!f) return;
    Backup.importZip(f).then(function(r){
      renderRecent();
      showOk("Copia restaurada: " + r.saves + (r.saves === 1 ? " partida" : " partidas") + (r.games ? " y " + r.games + (r.games === 1 ? " juego" : " juegos") + " con sus guardados rápidos" : "") +
        "." + (r.games ? " Si un juego aparece con «Falta el juego», tócalo y elige su archivo." : ""));
    })
      .catch(function(){ showErr("Ese archivo no parece una copia de partidas válida."); });
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
    navigator.serviceWorker.register("sw.js").catch(function(){});
  }

  var started = false, CURRENT_ID = null;
  function start(file, chosen){
    if (started) return;
    var detected = sysFromName(file.name);
    var p;
    if (detected==="gba" || detected==="nds") p = Promise.resolve(detected);
    else if (detected==="archive") p = chosen ? Promise.resolve(chosen) : guessFromZip(file);
    else p = Promise.resolve(chosen);
    p.then(function(sys){
      if (!sys){ showErr("No reconozco este archivo. Pulsa la tarjeta de GBA o de NDS y elígelo desde ahí."); return; }
      if (detected && detected!=="archive" && chosen && chosen!==detected){
        // Si el usuario pulsó la tarjeta equivocada, mandamos la extensión
        sys = detected;
      }
      launch(file, sys);
    });
  }

  function launch(file, sys){
    started = true;
    CURRENT_ID = gameId(file, sys);
    var base = file.name.replace(/\.[^.]+$/,"");
    // Nombre con el que EmulatorJS guarda la partida. Si ya hay OTRO juego con el mismo nombre de archivo,
    // a este se le añade el tamaño para que no compartan partida. Los que ya existían no cambian.
    Recent.list().then(function(items){
      var mine = items.filter(function(i){ return i.id === CURRENT_ID; })[0];
      var name = mine && mine.gameName ? mine.gameName : base;
      if (!mine && items.some(function(i){ return i.sys === sys && i.name.replace(/\.[^.]+$/,"") === base && i.size !== file.size; })) name = base + " (" + file.size + ")";
      Recent.save(file, sys, name);
      boot(file, sys, name);
    });
  }

  function boot(file, sys, name){
    applyAudioSession();
    var core = sys==="gba" ? "mgba" : dsCore;
    document.getElementById("home").style.display="none";
    document.getElementById("play").style.display="block";
    document.documentElement.style.background = document.body.style.background = "#000";
    setupPad(sys, core);

    window.EJS_player = "#game";
    window.EJS_core = core;
    window.EJS_gameUrl = file;           // EmulatorJS acepta un File/Blob directamente
    window.EJS_gameName = name;
    window.EJS_pathtodata = "data/";
    window.EJS_threads = false;
    window.EJS_forceLegacyCores = (gfx === "compat");   // WebGL 1: evita la pantalla en blanco de Safari en iPhone
    window.EJS_language = "es-ES";
    window.EJS_color = sys==="gba" ? "#7b5cff" : "#19c3a6";
    window.EJS_startOnLoaded = false;    // el toque en "Jugar" desbloquea el audio
    window.EJS_startButtonName = "Jugar";
    window.EJS_backgroundColor = "#000";
    window.EJS_Buttons = { netplay:false, cheat:false, cacheManager:false, exitEmulation:false, fullscreen:false, screenRecord:false, quickSave:false, quickLoad:false, screenshot:false, contextMenu:false };
    window.EJS_defaultOptions = { "save-state-location": "browser" };
    // EmulatorJS guardaba su propia copia de cada juego (duplicando el espacio): la biblioteca ya tiene la suya
    window.EJS_disableDatabases = true;
    // Ajustes de EmulatorJS que no sirven aquí o que ya gestiona nuestro menú
    window.EJS_hideSettings = ["screenshotSource","screenshotFormat","screenshotUpscale","screenRecordFPS","screenRecordFormat",
      "screenRecordUpscale","screenRecordVideoBitrate","screenRecordAudioBitrate","menubarBehavior","keyboardInput","altKeyboardInput",
      "lockMouse","virtual-gamepad","menu-bar-button","virtual-gamepad-left-handed-mode","save-state-location","save-save-interval",
      "save-state-slot","webgl2Enabled","shader","fastForward","ff-ratio","slowMotion","sm-ratio","rewindEnabled","videoRotation",
      "desmume_screens_layout","melonds_screen_layout","desmume_screens_gap","melonds_screen_gap"];
    window.EJS_onGameStart = function(){ gameStarted = true; applyDsLayout(); layout(); afterStart(); offerContinue(); };

    var s = document.createElement("script");
    s.src = "data/loader.js";
    document.body.appendChild(s);
  }

  /* ---------- Mando táctil propio y disposición vertical/horizontal ---------- */
  var gameStarted = false, SYS = "gba", CORE = "mgba", landscape = false;
  var stage = document.getElementById("stage"), game = document.getElementById("game"), pad = document.getElementById("pad");
  var el = function(id){ return document.getElementById(id); };

  function gm(){ return window.EJS_emulator && window.EJS_emulator.gameManager; }
  function key(k, v){ var g = gm(); if (g) try { g.simulateInput(0, k, v); } catch(e){} }

  function toast(msg, ms){ var t=el("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(function(){t.classList.remove("show");}, ms || 1600); }

  /* ---------- Preferencias (se recuerdan en este dispositivo) ---------- */
  var PREF_DEF = { landMode:"normal", ff:"3.0", filter:"sharp", dsMode:"normal", padSize:100, padOp:100, turbo:{}, offsets:{portrait:{}, landscape:{}}, silentSound:true, haptics:true };
  var prefs = (function(){ try { return Object.assign({}, PREF_DEF, JSON.parse(store.get("prefs") || "{}")); } catch(e){ return Object.assign({}, PREF_DEF); } })();
  if (!prefs.offsets || !prefs.offsets.portrait) prefs.offsets = {portrait:{}, landscape:{}};
  function savePrefs(){ store.set("prefs", JSON.stringify(prefs)); }

  // iPhone: por defecto Safari silencia las webs con el interruptor de silencio. "playback" hace que suene igualmente.
  function applyAudioSession(){
    try { if (navigator.audioSession) navigator.audioSession.type = prefs.silentSound ? "playback" : "auto"; } catch(e){}
  }

  // Vibración mínima al pulsar. iPhone (iOS 18+): truco del interruptor nativo; Android: vibrate().
  function hap(){
    if (!prefs.haptics) return;
    try {
      if (navigator.vibrate){ navigator.vibrate(5); return; }
      var lab = document.createElement("label"), inp = document.createElement("input");
      lab.setAttribute("aria-hidden", "true"); lab.style.display = "none";
      inp.type = "checkbox"; inp.setAttribute("switch", "");
      lab.appendChild(inp); document.head.appendChild(lab); lab.click(); document.head.removeChild(lab);
    } catch(e){}
  }
  function E_(){ return window.EJS_emulator; }

  // Proporción de la imagen: GBA 3:2; DS una pantalla 4:3, apiladas 2:3 o lado a lado 8:3
  function dsSingle(){ return prefs.dsMode === "top" || prefs.dsMode === "bottom"; }
  function aspect(){ return SYS==="gba" ? 3/2 : dsSingle() ? 4/3 : (landscape ? 8/3 : 2/3); }
  function nativeW(){ return SYS==="gba" ? 240 : (landscape && !dsSingle()) ? 512 : 256; }

  function applyDsLayout(){
    if (SYS!=="nds" || !gm()) return;
    var m = prefs.dsMode, mel = CORE==="melonds", v;
    if (m === "top") v = mel ? "Top Only" : "top only";
    else if (m === "bottom") v = mel ? "Bottom Only" : "bottom only";
    else if (m === "swap") v = landscape ? (mel ? "Right/Left" : "right/left") : (mel ? "Bottom/Top" : "bottom/top");
    else v = landscape ? (mel ? "Left/Right" : "left/right") : (mel ? "Top/Bottom" : "top/bottom");
    try { gm().setVariable(mel ? "melonds_screen_layout" : "desmume_screens_layout", v); } catch(e){}
  }

  function place(node, r){
    var st = node.style;
    ["left","top","right","bottom","width","height"].forEach(function(k){ st[k] = (r[k]==null) ? "" : r[k]+"px"; });
  }

  var stx = 1;
  function layout(){
    var W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    var wasLand = landscape;
    landscape = W > H;
    if (wasLand !== landscape) applyDsLayout();
    var a = aspect(), sw, sh, sx, sy, m = 10;
    var face = el("face"), dpad = el("dpad");

    if (!landscape){
      // Vertical: pantalla arriba a todo el ancho, mandos debajo
      var maxH = H - 230;                              // deja sitio mínimo para los mandos
      sw = W; sh = W / a;
      if (sh > maxH){ sh = Math.max(maxH, H*0.45); sw = sh * a; if (sw > W){ sw = W; sh = W/a; } }
      sx = (W - sw)/2; sy = 0;
      var top = sy + sh, ph = H - top;                 // zona de mandos
      var size = Math.max(112, Math.min(170, ph - 120, W*0.42));
      var cy = top + 56 + Math.min((ph - 56 - 56)/2, size/2 + 40);             // centro vertical entre la fila L/R y la fila inferior
      place(el("bL"), {left:m, top:top+8});
      place(el("bR"), {right:m, top:top+8});
      place(dpad, {left:m+4, top:cy-size/2, width:size, height:size});
      place(face, {right:m+4, top:cy-size/2, width:size, height:size});
      var by = 12;
      place(el("bBack"), {left:m, bottom:by});
      place(el("bSel"), {left:W/2-86, bottom:by-3+3});
      place(el("bSta"), {left:W/2+8, bottom:by});
      place(el("bFF"), {right:m+48, bottom:by});
      place(el("bMenu"), {right:m, bottom:by});
      place(el("bMic"), {left:W/2-20, top:top+8});
    } else {
      // Horizontal: pantalla centrada a toda la altura, mandos a los lados
      var side = Math.max(150, Math.min(210, W*0.2));
      var lm = SYS === "gba" ? prefs.landMode : "normal";
      if (lm === "full" || lm === "stretch"){
        // GBA a pantalla completa: toda la altura (los botones quedan encima de la imagen)
        sh = H; sw = H * a; if (sw > W){ sw = W; sh = W / a; }
      } else {
        sw = W - side*2; sh = sw / a;
        if (sh > H){ sh = H; sw = H*a; }
      }
      sx = (W - sw)/2; sy = (H - sh)/2;
      stx = 1;
      if (lm === "stretch"){ stx = W / sw; sx = 0; }       // estirada: se ensancha hasta los bordes
      var col = lm === "normal" ? Math.max(side, sx) : side;   // ancho real de cada lateral
      var size2 = Math.max(110, Math.min(160, col - 16, H - 130));
      place(el("bL"), {left:m, top:m});
      place(el("bMenu"), {left:m+82, top:m});
      place(el("bR"), {right:m, top:m});
      place(el("bFF"), {right:m+82, top:m});
      place(dpad, {left:(col-size2)/2, top:(H-size2)/2+6, width:size2, height:size2});
      place(face, {right:(col-size2)/2, top:(H-size2)/2+6, width:size2, height:size2});
      place(el("bBack"), {left:m, bottom:m});
      place(el("bSel"), {left:m+48, bottom:m+3});
      place(el("bSta"), {right:m, bottom:m+3});
      place(el("bMic"), {right:m+76, bottom:m});
    }
    // la imagen del juego (canvas de EmulatorJS) ocupa exactamente ese rectángulo
    stage.style.setProperty("--sx", sx+"px"); stage.style.setProperty("--sy", sy+"px");
    stage.style.setProperty("--sw", sw+"px"); stage.style.setProperty("--sh", sh+"px");
    stage.style.setProperty("--px", (sw / nativeW()) + "px");
    stage.style.setProperty("--stx", String(landscape ? stx : 1));
    el("play").classList.toggle("land", landscape);
    layoutFace();
    applyPadPrefs();
  }

  // Tamaño, opacidad y posición de los botones elegidos por el usuario (por orientación)
  var CTRLS = ["bL","bR","dpad","face","bSel","bSta","bFF","bMenu","bBack","bMic"];
  function applyPadPrefs(){
    var sc = (prefs.padSize || 100) / 100, offs = prefs.offsets[landscape ? "landscape" : "portrait"] || {};
    CTRLS.forEach(function(id){
      var n = el(id), o = offs[id] || [0,0];
      n.style.translate = o[0] + "px " + o[1] + "px";
      n.style.scale = String(sc);
    });
    pad.style.opacity = String((prefs.padOp || 100) / 100);
  }

  // Botones de acción: GBA = A/B en diagonal; DS = rombo X/A/B/Y
  var faceBtns = [];
  function buildFace(){
    var face = el("face"); face.innerHTML = "";
    var defs = SYS==="gba"
      ? [{t:"A",k:8,x:.74,y:.36},{t:"B",k:0,x:.26,y:.64}]
      : [{t:"X",k:9,x:.5,y:.2},{t:"A",k:8,x:.8,y:.5},{t:"B",k:0,x:.5,y:.8},{t:"Y",k:1,x:.2,y:.5}];
    faceBtns = defs.map(function(d){ var b=document.createElement("div"); b.className="vb fb"; b.textContent=d.t; face.appendChild(b); d.el=b; return d; });
  }
  function layoutFace(){
    var face = el("face"), S = face.clientWidth || 150;
    var r = SYS==="gba" ? S*0.24 : S*0.19;
    faceBtns.forEach(function(d){ d.r=r; place(d.el,{left:d.x*S-r, top:d.y*S-r, width:r*2, height:r*2}); });
  }

  // Cruceta de 8 direcciones (incluye diagonales)
  var dirKeys = {u:4, d:5, l:6, r:7}, dirState = {u:0,d:0,l:0,r:0};
  function setDirs(n){
    var any = n.u || n.d || n.l || n.r, changed = ["u","d","l","r"].some(function(k){ return dirState[k] !== n[k]; });
    if (any && changed) hap();
    ["u","d","l","r"].forEach(function(k){
      if (dirState[k] !== n[k]){ dirState[k] = n[k]; key(dirKeys[k], n[k]); }
      var lit = el("dpad").querySelector('.lit[data-d="'+k+'"]'); if (lit) lit.classList.toggle("on", !!n[k]);
    });
  }
  function dirsFrom(e){
    var rc = el("dpad").getBoundingClientRect();
    var dx = e.clientX - (rc.left + rc.width/2), dy = e.clientY - (rc.top + rc.height/2);
    var none = {u:0,d:0,l:0,r:0};
    if (Math.hypot(dx,dy) < rc.width*0.12) return none;           // zona muerta central
    var sector = ((Math.round(Math.atan2(dy,dx) / (Math.PI/4)) % 8) + 8) % 8;   // 0=dcha, 1=abajo-dcha, ...
    var map = [{r:1},{r:1,d:1},{d:1},{d:1,l:1},{l:1},{l:1,u:1},{u:1},{u:1,r:1}][sector];
    return {u:map.u|0, d:map.d|0, l:map.l|0, r:map.r|0};
  }
  function bindDpad(){
    var d = el("dpad"), id = null;
    d.addEventListener("pointerdown", function(e){ e.preventDefault(); id=e.pointerId; try{d.setPointerCapture(id);}catch(_){} setDirs(dirsFrom(e)); });
    d.addEventListener("pointermove", function(e){ if (e.pointerId===id) setDirs(dirsFrom(e)); });
    var end = function(e){ if (e.pointerId===id){ id=null; setDirs({u:0,d:0,l:0,r:0}); } };
    d.addEventListener("pointerup", end); d.addEventListener("pointercancel", end); d.addEventListener("lostpointercapture", end);
  }

  // Botones de acción: se puede deslizar y pulsar dos a la vez tocando entre ellos
  var facePointers = {}, faceState = {};
  function faceHits(e){
    var rc = el("face").getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, S = rc.width, hit = [], best=null, bd=1e9;
    var k = S / (el("face").offsetWidth || S);          // escala elegida por el usuario
    faceBtns.forEach(function(b){
      var dist = Math.hypot(x - b.x*S, y - b.y*S);
      if (dist < b.r*k*1.18) hit.push(b.k);
      if (dist < bd){ bd = dist; best = b; }
    });
    if (!hit.length && best && bd < best.r*k*1.7) hit.push(best.k);
    return hit;
  }
  function syncFace(){
    var want = {};
    Object.keys(facePointers).forEach(function(p){ facePointers[p].forEach(function(k){ want[k]=1; }); });
    faceBtns.forEach(function(b){
      var v = want[b.k] ? 1 : 0;
      if ((faceState[b.k]||0) !== v){
        faceState[b.k] = v;
        if (v) hap();
        if (!prefs.turbo[b.k] || !v) key(b.k, v);          // con turbo, la pulsación la da el bucle de abajo
      }
      b.el.classList.toggle("on", !!v);
    });
  }
  // Turbo: mientras se mantiene el botón, se pulsa y suelta solo ~10 veces por segundo
  var turboPhase = 0;
  setInterval(function(){
    if (!gameStarted) return;
    turboPhase ^= 1;
    Object.keys(prefs.turbo).forEach(function(k){ if (prefs.turbo[k] && faceState[k]) key(+k, turboPhase); });
  }, 50);
  function bindFace(){
    var f = el("face");
    f.addEventListener("pointerdown", function(e){ e.preventDefault(); try{f.setPointerCapture(e.pointerId);}catch(_){} facePointers[e.pointerId]=faceHits(e); syncFace(); });
    f.addEventListener("pointermove", function(e){ if (facePointers[e.pointerId]){ facePointers[e.pointerId]=faceHits(e); syncFace(); } });
    var end = function(e){ delete facePointers[e.pointerId]; syncFace(); };
    f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end); f.addEventListener("lostpointercapture", end);
  }

  function bindHold(node){        // L, R, Select, Start
    var k = +node.dataset.k, n = 0;
    node.addEventListener("pointerdown", function(e){ e.preventDefault(); try{node.setPointerCapture(e.pointerId);}catch(_){} if(!n++){ key(k,1); hap(); } node.classList.add("on"); });
    var end = function(){ if (n){ n=0; key(k,0); node.classList.remove("on"); } };
    node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end); node.addEventListener("lostpointercapture", end);
    releasers.push(end);
  }
  var releasers = [];
  // Red de seguridad contra botones "atascados": si iOS no avisa de que se ha levantado un dedo
  // (gestos del sistema, notificaciones…), al no quedar ningún dedo en la pantalla se suelta todo.
  ["touchend", "touchcancel"].forEach(function(ev){
    document.addEventListener(ev, function(e){ if (gameStarted && e.touches && e.touches.length === 0) releaseAll(); }, true);
  });
  window.addEventListener("blur", function(){ if (gameStarted) releaseAll(); });
  function releaseAll(){       // suelta todo lo pulsado (evita teclas "atascadas" al volver)
    setDirs({u:0,d:0,l:0,r:0});
    facePointers = {}; syncFace();
    releasers.forEach(function(f){ f(); });
  }

  /* ---------- Volver de otra app (iOS congela el audio y el bucle del juego) ---------- */
  function audioCtxs(){
    var out = [];
    try {
      var AL = window.EJS_emulator.Module.AL;
      if (AL && AL.currentCtx){
        if (AL.currentCtx.audioCtx) out.push(AL.currentCtx.audioCtx);
        (AL.currentCtx.sources || []).forEach(function(src){ if (src && src.gain && out.indexOf(src.gain.context) < 0) out.push(src.gain.context); });
      }
    } catch(e){}
    return out;
  }
  /* ---------- Guardado: partida del juego (SRAM) y estado automático ---------- */
  // EmulatorJS solo vuelca la partida guardada del juego a la memoria del navegador cada 5 minutos.
  // La volcamos nosotros cada 30 s, al salir de la app y antes de cerrar el juego.
  // Solo se escribe si el juego ha avanzado y la partida ha cambiado de verdad: si no cambia, se deja la
  // fecha del archivo como estaba y así no se reescribe en la memoria del navegador.
  var lastFlushFrame = -1;
  function sameBytes(a, b){ if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function flushSaves(force){
    return new Promise(function(res){
      var g = gm(); if (!g || !gameStarted) return res();
      var frame = -1; try { frame = g.getFrameNum(); } catch(e){}
      if (!force && frame === lastFlushFrame) return res();      // el juego no ha avanzado desde la última vez
      lastFlushFrame = frame;
      var path = null, before = null, stamp = null;
      try { path = g.getSaveFilePath(); var st = g.FS.stat(path); stamp = st.mtime.getTime(); before = g.FS.readFile(path); } catch(e){}
      try { g.saveSaveFiles(); } catch(e){}
      try {
        if (before && sameBytes(before, g.FS.readFile(path))){ g.FS.utime(path, stamp, stamp); return res(); }
      } catch(e){}
      var done = false, fin = function(){ if (!done){ done = true; res(); } };
      try { g.FS.syncfs(false, fin); } catch(e){ fin(); }
      setTimeout(fin, 2500);
    });
  }
  function saveAutoState(){
    var g = gm(); if (!g || !gameStarted || !CURRENT_ID || continueOpen) return Promise.resolve();
    try {
      var st = g.getState();
      return Recent.putState(CURRENT_ID, new Blob([st])).catch(function(){});
    } catch(e){ return Promise.resolve(); }
  }
  setInterval(function(){ if (gameStarted && !document.hidden){ flushSaves(); if (!anySheet()) saveThumb(); } }, 30000);

  // MUY IMPORTANTE: al recargar o cerrar la página, EmulatorJS ejecuta su "salida", que desmonta la carpeta
  // de partidas mientras aún se está guardando y acaba BORRANDO todas las partidas de IndexedDB.
  // Volcamos la partida y le decimos que el juego ya no está en marcha para que no ejecute esa salida.
  window.addEventListener("beforeunload", function(){
    if (!gameStarted) return;
    try { gm().saveSaveFiles(); } catch(e){}
    try { window.EJS_emulator.started = false; } catch(e){}
  });

  var continueOpen = false;
  function offerContinue(){
    if (!CURRENT_ID) return;
    Recent.getState(CURRENT_ID).then(function(rec){
      if (!rec || !rec.blob) return;
      var E = window.EJS_emulator; try { E.pause(); } catch(e){}
      continueOpen = true;
      el("contWhen").textContent = "Guardado " + ago(rec.ts);
      el("cont").classList.add("show");
      var close = function(){ continueOpen = false; el("cont").classList.remove("show"); try { E.play(); } catch(e){} };
      el("contYes").onclick = function(){
        rec.blob.arrayBuffer().then(function(buf){
          try { gm().loadState(new Uint8Array(buf)); toast("Partida recuperada"); } catch(e){ toast("No se pudo cargar el guardado automático"); }
          close();
        });
      };
      el("contNo").onclick = close;
    }).catch(function(){});
  }

  var pausedByUs = false;
  function onHide(){
    if (!gameStarted) return;
    releaseAll();
    flushSaves(true); saveAutoState(); commitTime();
    var E = window.EJS_emulator;
    if (E && !E.paused){ try { E.pause(); pausedByUs = true; } catch(e){} }
    audioCtxs().forEach(function(c){ try { c.suspend(); } catch(e){} });
  }
  function askResume(){
    if (!gameStarted) return;
    el("resume").classList.add("show");
  }
  function doResume(){
    el("resume").classList.remove("show");
    audioCtxs().forEach(function(c){ try { c.resume(); } catch(e){} });
    var E = window.EJS_emulator;
    if (pausedByUs && E){ try { E.play(); } catch(e){} }
    pausedByUs = false;
    releaseAll(); layout();
  }
  document.addEventListener("visibilitychange", function(){ if (document.hidden) onHide(); else askResume(); });
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", function(e){ if (e.persisted) askResume(); });
  // Red de seguridad: si el audio se queda parado sin que lo hayamos pausado, ofrecer reanudar
  setInterval(function(){
    if (!gameStarted || document.hidden || el("resume").classList.contains("show")) return;
    var E = window.EJS_emulator; if (!E || E.paused) return;
    if (audioCtxs().some(function(c){ return c.state && c.state !== "running"; })) { pausedByUs = false; askResume(); }
  }, 1500);

  /* ---------- Miniaturas (para Recientes y las ranuras) ---------- */
  function shot(){                 // captura del juego en PNG; solo funciona con el juego en marcha
    var g = gm(), E = E_();
    if (!g || !gameStarted || !E || E.paused) return Promise.resolve(null);
    return Promise.race([g.screenshot(), new Promise(function(r){ setTimeout(function(){ r(null); }, 700); })])
      .then(function(png){ return png ? new Blob([png], {type:"image/png"}) : null; }).catch(function(){ return null; });
  }
  function saveThumb(){
    return shot().then(function(b){ if (b && CURRENT_ID) return Recent.setThumb(CURRENT_ID, b).catch(function(){}); });
  }

  /* ---------- Tiempo de juego ---------- */
  var playSecs = 0, playTick = null;
  setInterval(function(){
    var E = E_(), now = Date.now();
    var running = gameStarted && !document.hidden && E && !E.paused && !anySheet();
    if (running && playTick) playSecs += Math.min(10, (now - playTick) / 1000);
    playTick = running ? now : null;
  }, 2000);
  function commitTime(){
    if (!CURRENT_ID || playSecs < 1) return Promise.resolve();
    var s = Math.round(playSecs); playSecs = 0;
    return Recent.addTime(CURRENT_ID, s).catch(function(){});
  }
  setInterval(function(){ if (gameStarted) commitTime(); }, 60000);

  /* ---------- Al arrancar el juego ---------- */
  function afterStart(){
    var E = E_();
    moveAdvanced();
    applyFF(); applyFilter();
    if (CORE === "melonds") try { gm().setVariable("melonds_mic_input", "Blow Noise"); } catch(e){}
    setTimeout(saveThumb, 4000);
    perfWatch();
  }
  function applyFF(){ try { E_().menuOptionChanged("ff-ratio", prefs.ff); } catch(e){} }
  function applyFilter(){
    var f = prefs.filter, shader = f === "smooth" ? "bicubic" : f === "crt" ? "crt-zfast" : "disabled";
    try { E_().menuOptionChanged("shader", shader); } catch(e){}
    stage.classList.toggle("sharp", f === "sharp" || f === "lcd");
    stage.classList.toggle("lcd", f === "lcd");
  }

  /* ---------- Aviso si el juego va lento ---------- */
  function perfWatch(){
    var last = null, slow = 0, warned = false;
    setInterval(function(){
      var g = gm(), E = E_();
      if (warned || !g || document.hidden || !E || E.paused || el("bFF").classList.contains("on") || anySheet()){ last = null; return; }
      var now = performance.now(), f = g.getFrameNum();
      if (last){
        var fps = (f - last.f) / ((now - last.t) / 1000);
        slow = fps < 48 ? slow + 1 : 0;
        if (slow >= 3){
          warned = true;
          toast(SYS === "nds" && CORE === "melonds"
            ? "El juego va lento. Prueba el motor Rápido (DeSmuME) en la pantalla de inicio."
            : "El juego va lento. En ☰ › Avanzado puedes activar el salto de fotogramas (frameskip).", 6000);
        }
      }
      last = {f: f, t: now};
    }, 4000);
  }

  /* ---------- Menú ☰ ---------- */
  var sheetPaused = false, keepPaused = false;
  function anySheet(){ return el("sheet").classList.contains("show") || el("adv").classList.contains("show"); }
  function pauseForSheet(){
    var E = E_();
    if (E && !E.paused){ try { E.pause(); sheetPaused = true; } catch(e){} }
  }
  function resumeAfterSheet(){
    var E = E_();
    if (sheetPaused && !keepPaused && E){ try { E.play(); } catch(e){} }
    sheetPaused = false;
  }
  function openMenu(){
    releaseAll();
    var E = E_(), was = E && E.paused;
    keepPaused = !!was; if (was) sheetPaused = true;
    paintMenu();
    // el menú aparece al instante; la captura para las ranuras se toma en el siguiente fotograma y luego se pausa
    menuShot = null;
    el("sheet").classList.add("show"); renderSlots();
    shot().then(function(b){ menuShot = b; if (el("sheet").classList.contains("show")) pauseForSheet(); });
  }
  function closeSheets(){
    el("sheet").classList.remove("show");
    if (el("adv").classList.contains("show")){ el("adv").classList.remove("show"); try { E_().closeSettingsMenu(); } catch(e){} }
    resumeAfterSheet();
  }
  var menuShot = null;

  function paintSegV(id, val, attr){
    document.querySelectorAll("#" + id + " button").forEach(function(b){ b.classList.toggle("on", b.dataset[attr || "v"] === String(val)); });
  }
  function paintMenu(){
    var E = E_();
    el("mPause").querySelector("span").textContent = keepPaused ? "Reanudar" : "Pausa";
    el("mPause").querySelector("i").textContent = keepPaused ? "▶" : "⏸";
    var muted = E && E.muted;
    el("mMute").querySelector("i").textContent = muted ? "🔇" : "🔊";
    el("mMute").querySelector("span").textContent = muted ? "Sin sonido" : "Sonido";
    paintSegV("ffSeg", prefs.ff);
    paintSegV("filterSeg", prefs.filter);
    paintSegV("dsSeg", prefs.dsMode);
    paintSegV("landSeg", prefs.landMode);
    el("landOpts").style.display = SYS === "gba" ? "" : "none";
    document.querySelectorAll("#turboSeg button").forEach(function(b){ b.classList.toggle("on", !!prefs.turbo[b.dataset.k]); });
    document.querySelectorAll("#optSeg button").forEach(function(b){ b.classList.toggle("on", !!prefs[b.dataset.o]); });
    el("dsOpts").style.display = SYS === "nds" ? "" : "none";
    el("padSize").value = prefs.padSize; el("padSizeV").textContent = prefs.padSize + "%";
    el("padOp").value = prefs.padOp; el("padOpV").textContent = prefs.padOp + "%";
  }

  // Guardado rápido: 4 ranuras por juego, con miniatura
  var slotUrls = [];
  function renderSlots(){
    var box = el("slots"); box.innerHTML = "";
    slotUrls.forEach(function(u){ URL.revokeObjectURL(u); }); slotUrls = [];
    [1,2,3,4].forEach(function(n){
      var d = document.createElement("div"); d.className = "slot";
      d.innerHTML = '<div class="pic">Ranura ' + n + '</div><div class="when">Vacía</div><div class="bt"><button data-a="save">Guardar</button><button data-a="load" disabled>Cargar</button></div>';
      box.appendChild(d);
      Recent.getSlot(CURRENT_ID, n).then(function(rec){
        if (!rec) return;
        d.querySelector(".when").textContent = ago(rec.ts);
        d.querySelector('[data-a="load"]').disabled = false;
        if (rec.thumb){ var u = URL.createObjectURL(rec.thumb); slotUrls.push(u); var pic = d.querySelector(".pic"); pic.textContent = ""; pic.style.backgroundImage = "url(" + u + ")"; }
        d.dataset.full = "1";
      }).catch(function(){});
      var armedSave = false, t;
      d.querySelector('[data-a="save"]').onclick = function(){
        var btn = this;
        if (d.dataset.full && !armedSave){ armedSave = true; btn.textContent = "¿Seguro?"; clearTimeout(t); t = setTimeout(function(){ armedSave = false; btn.textContent = "Guardar"; }, 2500); return; }
        try {
          var st = gm().getState();
          Recent.putSlot(CURRENT_ID, n, {blob: new Blob([st]), thumb: menuShot, ts: Date.now()})
            .then(function(){ toast("Guardado en la ranura " + n); renderSlots(); })
            .catch(function(){ toast("No había espacio para guardar"); });
        } catch(e){ toast("Este juego no permite guardado rápido"); }
      };
      d.querySelector('[data-a="load"]').onclick = function(){
        Recent.getSlot(CURRENT_ID, n).then(function(rec){
          if (!rec) return;
          return rec.blob.arrayBuffer().then(function(buf){
            gm().loadState(new Uint8Array(buf)); keepPaused = false; closeSheets(); toast("Ranura " + n + " cargada");
          });
        }).catch(function(){ toast("No se pudo cargar"); });
      };
    });
  }

  // Ajustes avanzados: el menú de ajustes de EmulatorJS, dentro de nuestra hoja
  function moveAdvanced(){
    var E = E_();
    try { if (E.settingParent && E.settingParent.parentNode !== el("advBody")) el("advBody").appendChild(E.settingParent); } catch(e){}
  }
  function openAdvanced(){
    var E = E_(); moveAdvanced();
    el("sheet").classList.remove("show");
    el("adv").classList.add("show");
    try { E.settingsMenuOpen = true; E.settingsMenu.style.display = ""; } catch(e){}
    try {
      // Grupos que se quedan vacíos porque sus ajustes los gestiona nuestro menú
      var empty = ["Screen Capture","Speed Options","Input Options","Save States","Virtual Gamepad"];
      el("advBody").querySelectorAll(".ejs_settings_main_bar").forEach(function(b){
        if (empty.indexOf(b.innerText.trim()) >= 0) b.style.display = "none";
      });
      // EmulatorJS deja sin traducir los títulos de los grupos: los traducimos con su propio diccionario
      var lang = E.config.langJson || {}, walker = document.createTreeWalker(el("advBody"), NodeFilter.SHOW_TEXT), n;
      while ((n = walker.nextNode())){ var t = n.nodeValue.trim(); if (t && lang[t]) n.nodeValue = lang[t]; }
    } catch(e){}
  }

  function bindMenu(){
    document.querySelectorAll("[data-close]").forEach(function(b){ b.addEventListener("click", closeSheets); });
    // Cerrar tocando fuera, pero solo si el toque empezó fuera (si no, el mismo toque que abre el menú lo cerraría)
    ["sheet","adv"].forEach(function(id){
      var downOut = false;
      el(id).addEventListener("pointerdown", function(e){ downOut = e.target === el(id); });
      el(id).addEventListener("click", function(e){ if (e.target === el(id) && downOut) closeSheets(); downOut = false; });
    });
    el("mPause").onclick = function(){ keepPaused = !keepPaused; paintMenu(); if (keepPaused) toast("Seguirá en pausa al cerrar el menú"); };
    el("mRestart").onclick = function(){ try { gm().restart(); } catch(e){} keepPaused = false; closeSheets(); toast("Juego reiniciado"); };
    el("mMute").onclick = function(){
      var E = E_(); if (!E) return;
      if (E.muted){ E.setVolume(prefs.vol || 0.5); } else { prefs.vol = E.volume || 0.5; savePrefs(); E.setVolume(0); }
      paintMenu();
    };
    el("mPadMap").onclick = function(){ el("sheet").classList.remove("show"); try { E_().controlMenu.style.display = ""; } catch(e){} resumeAfterSheet(); };
    el("mAdv").onclick = openAdvanced;
    // Partida en .sav (compatible con otros emuladores)
    el("savExport").onclick = function(){
      try {
        var data = gm().getSaveFile();
        if (!data || !data.length){ toast("Este juego aún no tiene partida guardada"); return; }
        var f = new File([data], (window.EJS_gameName || "partida") + ".sav", {type:"application/octet-stream"});
        if (navigator.canShare && navigator.canShare({files:[f]})) navigator.share({files:[f]}).catch(function(){});
        else { var a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(function(){ a.remove(); }, 3000); }
      } catch(e){ toast("No se pudo exportar la partida"); }
    };
    var savArmed = false;
    el("savImport").onclick = function(){
      if (!savArmed){ savArmed = true; this.textContent = "Reemplaza tu partida: toca otra vez"; var b = this; setTimeout(function(){ savArmed = false; b.textContent = "Importar .sav"; }, 3000); return; }
      savArmed = false; this.textContent = "Importar .sav"; el("savFile").value = ""; el("savFile").click();
    };
    el("savFile").onchange = function(){
      var f = this.files[0]; if (!f) return;
      f.arrayBuffer().then(function(buf){
        var g = gm(), path = g.getSaveFilePath();
        try { g.FS.unlink(path); } catch(e){}
        try { g.FS.mkdirTree ? g.FS.mkdirTree(path.replace(/\/[^\/]+$/, "")) : 0; } catch(e){}
        g.FS.writeFile(path, new Uint8Array(buf));
        try { g.loadSaveFiles(); } catch(e){}
        return new Promise(function(r){ try { g.FS.syncfs(false, function(){ r(); }); } catch(e){ r(); } });
      }).then(function(){
        try { gm().restart(); } catch(e){}
        Recent.clearExtras(CURRENT_ID).catch(function(){});      // el "continuar" y las ranuras viejas ya no casan con la partida nueva
        keepPaused = false; closeSheets(); toast("Partida importada: el juego se ha reiniciado", 3000);
      }).catch(function(){ toast("No se pudo importar ese archivo"); });
    };
    document.querySelectorAll("#optSeg button").forEach(function(b){ b.onclick = function(){
      prefs[b.dataset.o] = !prefs[b.dataset.o]; savePrefs(); paintMenu();
      if (b.dataset.o === "silentSound") applyAudioSession();
      if (b.dataset.o === "haptics" && prefs.haptics) hap();
    }; });
    document.querySelectorAll("#ffSeg button").forEach(function(b){ b.onclick = function(){ prefs.ff = b.dataset.v; savePrefs(); applyFF(); paintMenu(); }; });
    document.querySelectorAll("#filterSeg button").forEach(function(b){ b.onclick = function(){ prefs.filter = b.dataset.v; savePrefs(); applyFilter(); paintMenu(); }; });
    document.querySelectorAll("#landSeg button").forEach(function(b){ b.onclick = function(){ prefs.landMode = b.dataset.v; savePrefs(); layout(); paintMenu();
      if (!landscape) toast("Se verá al girar el móvil en horizontal"); }; });
    document.querySelectorAll("#dsSeg button").forEach(function(b){ b.onclick = function(){ prefs.dsMode = b.dataset.v; savePrefs(); applyDsLayout(); layout(); paintMenu(); }; });
    document.querySelectorAll("#turboSeg button").forEach(function(b){ b.onclick = function(){ prefs.turbo[b.dataset.k] = !prefs.turbo[b.dataset.k]; savePrefs(); paintMenu(); }; });
    el("padSize").oninput = function(){ prefs.padSize = +this.value; savePrefs(); paintMenu(); layout(); };
    el("padOp").oninput = function(){ prefs.padOp = +this.value; savePrefs(); paintMenu(); applyPadPrefs(); };
    el("padEdit").onclick = function(){ el("sheet").classList.remove("show"); el("play").classList.add("editing"); };
    el("padReset").onclick = function(){
      prefs.offsets[landscape ? "landscape" : "portrait"] = {}; prefs.padSize = 100; prefs.padOp = 100; savePrefs(); paintMenu(); layout();
      toast("Botones restablecidos");
    };
    el("editDone").addEventListener("pointerdown", function(e){ e.preventDefault(); el("play").classList.remove("editing"); savePrefs(); resumeAfterSheet(); });
  }

  // Mover botones: en modo edición, arrastrar cualquier control
  function bindEdit(){
    var drag = null;
    pad.addEventListener("pointerdown", function(e){
      if (!el("play").classList.contains("editing")) return;
      var n = e.target.closest("#pad > *"); if (!n) return;
      e.preventDefault(); e.stopPropagation();
      var ok = landscape ? "landscape" : "portrait", o = prefs.offsets[ok][n.id] || [0,0];
      drag = {n: n, id: e.pointerId, x: e.clientX, y: e.clientY, o: o.slice(), key: ok, r: n.getBoundingClientRect(), s: stage.getBoundingClientRect()};
      try { pad.setPointerCapture(e.pointerId); } catch(_){}
    }, true);
    pad.addEventListener("pointermove", function(e){
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
      var cl = function(v, a, b){ return Math.max(a, Math.min(b, v)); };     // que el botón no se salga de la pantalla
      var dx = cl(e.clientX - drag.x, drag.s.left - drag.r.left, drag.s.right - drag.r.right);
      var dy = cl(e.clientY - drag.y, drag.s.top - drag.r.top, drag.s.bottom - drag.r.bottom);
      var v = [Math.round(drag.o[0] + dx), Math.round(drag.o[1] + dy)];
      prefs.offsets[drag.key][drag.n.id] = v;
      drag.n.style.translate = v[0] + "px " + v[1] + "px";
    }, true);
    var end = function(e){ if (drag && e.pointerId === drag.id){ drag = null; savePrefs(); } };
    pad.addEventListener("pointerup", end, true); pad.addEventListener("pointercancel", end, true);
  }

  /* ---------- Mandos Bluetooth: ocultar los botones táctiles ---------- */
  window.addEventListener("gamepadconnected", function(e){
    if (!started) return;
    pad.classList.add("gp-hidden");
    toast("Mando conectado: botones táctiles ocultos. Toca la pantalla para verlos.", 3500);
  });
  window.addEventListener("gamepaddisconnected", function(){ pad.classList.remove("gp-hidden"); });
  var comboSince = 0, comboDone = false;
  setInterval(function(){
    if (!gameStarted || !navigator.getGamepads) return;
    var pressed = false;
    try { Array.prototype.forEach.call(navigator.getGamepads(), function(gp){
      if (gp && gp.buttons && gp.buttons[8] && gp.buttons[9] && gp.buttons[8].pressed && gp.buttons[9].pressed) pressed = true;
    }); } catch(e){}
    if (!pressed){ comboSince = 0; comboDone = false; return; }
    if (!comboSince) comboSince = Date.now();
    if (!comboDone && Date.now() - comboSince > 500){
      comboDone = true;
      if (anySheet()) closeSheets(); else openMenu();
    }
  }, 100);
  stage.addEventListener("pointerdown", function(e){
    if (pad.classList.contains("gp-hidden") && e.pointerType === "touch"){ pad.classList.remove("gp-hidden"); }
  }, true);

  function setupPad(sys, core){
    SYS = sys; CORE = core;
    pad.className = sys;
    buildFace(); bindDpad(); bindFace();
    ["bL","bR","bSel","bSta"].forEach(function(id){ bindHold(el(id)); });
    if (sys==="gba") { /* L y R existen en ambas */ }

    var ff = false;
    el("bFF").addEventListener("pointerdown", function(e){
      e.preventDefault(); ff = !ff; key(27, ff?1:0); hap();
      el("bFF").classList.toggle("on", ff); toast(ff ? "Avance rápido ×" + parseInt(prefs.ff, 10) : "Velocidad normal");
    });
    el("bMenu").addEventListener("pointerdown", function(e){ e.preventDefault(); hap(); openMenu(); });
    // Micrófono de DS (soplar): DeSmuME usa L3 y melonDS usa L2
    var mic = el("bMic");
    mic.addEventListener("pointerdown", function(e){ e.preventDefault(); try{mic.setPointerCapture(e.pointerId);}catch(_){} key(CORE === "melonds" ? 12 : 14, 1); mic.classList.add("on"); hap(); });
    var micEnd = function(){ key(CORE === "melonds" ? 12 : 14, 0); mic.classList.remove("on"); };
    mic.addEventListener("pointerup", micEnd); mic.addEventListener("pointercancel", micEnd);
    bindMenu(); bindEdit();
    var armed = false, armT;
    el("bBack").addEventListener("pointerdown", function(e){
      e.preventDefault();
      if (armed){
        el("bBack").textContent = "Guardando…";
        saveThumb().then(function(){ return Promise.all([flushSaves(true), saveAutoState(), commitTime()]); }).then(function(){ location.reload(); });
        return;
      }
      armed = true; el("bBack").classList.add("armed"); el("bBack").textContent = "¿Salir? toca otra vez";
      clearTimeout(armT); armT = setTimeout(function(){ armed=false; el("bBack").classList.remove("armed"); el("bBack").textContent="←"; }, 2500);
    });

    el("resume").addEventListener("pointerdown", function(e){ e.preventDefault(); doResume(); });

    var relayout = function(){ requestAnimationFrame(layout); setTimeout(layout, 350); };
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", relayout);
    layout();
  }
})();
