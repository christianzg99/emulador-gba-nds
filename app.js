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

  var SYSINFO = { gba:{tag:"GBA", name:"Game Boy Advance"}, nds:{tag:"NDS", name:"Nintendo DS"}, n64:{tag:"N64", name:"Nintendo 64"} };
  function sysTag(s){ return (SYSINFO[s] || SYSINFO.gba).tag; }
  function sysFromName(name){
    var ext = (name.split(".").pop()||"").toLowerCase();
    if (["gba","gb","gbc","agb","sgb"].indexOf(ext)>=0) return "gba";
    if (["nds","dsi","srl"].indexOf(ext)>=0) return "nds";
    if (["n64","z64","v64"].indexOf(ext)>=0) return "n64";
    if (["zip","7z","rar"].indexOf(ext)>=0) return "archive";
    return null;
  }

  // Para .zip sin tarjeta elegida: busca el nombre del archivo interno en la cabecera ZIP
  function guessFromZip(file){
    return file.slice(0, Math.min(file.size, 4096)).arrayBuffer().then(function(buf){
      var txt = new TextDecoder("latin1").decode(new Uint8Array(buf)).toLowerCase();
      if (/\.nds/.test(txt)) return "nds";
      if (/\.[nzv]64/.test(txt)) return "n64";
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
    function delSlot(id, n){ return tx(["slots"], "readwrite", function(t){ t.objectStore("slots").delete(id + "#" + n); }); }
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
            setThumb:setThumb, addTime:addTime, update:update, putSlot:putSlot, getSlot:getSlot, delSlot:delSlot, sizes:sizes, dumpExtras:dumpExtras, loadExtras:loadExtras};
  })();

  function gameId(file, sys){ return sys + ":" + file.name + ":" + file.size; }

  function ago(ts){
    var m = Math.round((Date.now()-ts)/60000);
    if (m < 1) return "ahora mismo"; if (m < 60) return "hace " + m + " min";
    var h = Math.round(m/60); if (h < 24) return "hace " + h + " h";
    var d = Math.round(h/24); return d === 1 ? "ayer" : "hace " + d + " días";
  }
  function mb(b){ if (b >= 1073741824) return (b/1073741824).toFixed(1).replace(".0","").replace(".", ",") + " GB"; return b >= 1048576 ? (b >= 104857600 ? Math.round(b/1048576) : (b/1048576).toFixed(1).replace(".0","")) + " MB" : Math.max(1, Math.round(b/1024)) + " KB"; }
  function dur(secs){
    var m = Math.floor((secs||0) / 60), h = Math.floor(m / 60);
    return h ? h + " h " + (m % 60) + " min" : m ? m + " min" : "menos de 1 min";
  }

  // Carátula oficial (libretro-thumbnails) a partir del nombre estándar del archivo
  function artUrl(it){
    var ext = (it.name.split(".").pop() || "").toLowerCase();
    var sys = it.sys === "n64" ? "Nintendo_-_Nintendo_64" : it.sys === "nds" ? "Nintendo_-_Nintendo_DS" : ext === "gb" ? "Nintendo_-_Game_Boy" : ext === "gbc" ? "Nintendo_-_Game_Boy_Color" : "Nintendo_-_Game_Boy_Advance";
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
        var label = sysTag(it.sys);
        b.innerHTML = '<div class="tag '+it.sys+'"><b>'+label+'</b></div><div class="txt"><div class="nm"></div><div class="mt"></div></div>' +
          '<div class="fav'+(it.fav?' on':'')+'" aria-label="Favorito">★</div><div class="more" aria-label="Opciones">⋯</div>';
        b.querySelector(".nm").textContent = it.name.replace(/\.[^.]+$/, "");
        var mt = b.querySelector(".mt");
        if (hasRom) [it.playTime ? dur(it.playTime) + " jugado" : "Sin jugar aún", ago(it.last), mb(s.rom + s.extra)].forEach(function(t){ var x = document.createElement("span"); x.textContent = t; mt.appendChild(x); });
        else mt.textContent = "Falta el archivo del juego: tócalo para elegirlo";
        // carátula oficial; si no hay, la última captura; si no, la etiqueta
        var tag = b.querySelector(".tag"), img = new Image();
        img.alt = ""; img.crossOrigin = "anonymous"; img.onload = function(){ tag.classList.add("art"); tag.appendChild(img); };
        img.onerror = function(){
          if (!it.thumb) return;
          var u = URL.createObjectURL(it.thumb); libUrls.push(u);
          var im2 = new Image(); im2.onload = function(){ tag.classList.add("shot"); tag.appendChild(im2); }; im2.src = u;
        };
        if (it.cover){ var cu = URL.createObjectURL(it.cover); libUrls.push(cu); img.src = cu; } else img.src = artUrl(it);
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
      renderResume(items, sz);
    });
  }
  // La pieza grande del inicio: el último juego al que has jugado
  var rcUrl = null;
  function renderResume(items, sz){
    var card = document.getElementById("resumeCard");
    var last = items.filter(function(i){ return (sz[i.id] || {}).rom > 0; }).sort(function(a, b){ return b.last - a.last; })[0];
    
    if (!last){ card.hidden = true; return; }
    card.hidden = false;
    card.querySelector(".rc-name").textContent = last.name.replace(/\.[^.]+$/, "");
    card.querySelector(".rc-meta").textContent = (last.playTime ? dur(last.playTime) + " jugado, " : "") + "última vez " + ago(last.last);
    var art = card.querySelector(".rc-art"); art.className = "rc-art"; art.style.backgroundImage = ""; art.innerHTML = "<b>" + sysTag(last.sys) + "</b>";
    var img = new Image(); img.crossOrigin = "anonymous";
    img.onload = function(){ art.innerHTML = ""; art.style.backgroundImage = 'url("' + img.src + '")'; };
    img.onerror = function(){
      if (!last.thumb) return;
      if (rcUrl) URL.revokeObjectURL(rcUrl);
      rcUrl = URL.createObjectURL(last.thumb); art.innerHTML = ""; art.classList.add("shot"); art.style.backgroundImage = 'url("' + rcUrl + '")';
    };
    if (last.cover){ if (rcUrl) URL.revokeObjectURL(rcUrl); rcUrl = URL.createObjectURL(last.cover); img.src = rcUrl; } else img.src = artUrl(last);
    card.querySelector(".rc-play").onclick = function(){
      var btn = this; btn.textContent = "Cargando…"; btn.disabled = true;
      Recent.get(last.id).then(function(blob){
        if (!blob){ btn.textContent = "Continuar"; btn.disabled = false; showErr("No he encontrado ese juego guardado. Ábrelo de nuevo desde Archivos."); return; }
        launch(new File([blob], last.name), last.sys);
      }).catch(function(){ btn.textContent = "Continuar"; btn.disabled = false; showErr("No se pudo abrir. Ábrelo de nuevo desde Archivos."); });
    };
  }
  function renderStorage(items, sz){
    var total = 0; Object.keys(sz).forEach(function(k){ total += sz[k].rom + sz[k].extra; });
    var elx = document.getElementById("libStore");
    var txt = items.length + (items.length === 1 ? " juego, " : " juegos, ") + mb(total);
    elx.textContent = txt;
    try {
      navigator.storage.estimate().then(function(e){
        if (!e || !e.quota) return;
        var free = e.quota - e.usage;
        elx.innerHTML = ""; elx.append(txt, document.createElement("br"), "Quedan " + mb(free) + " libres");
        elx.classList.toggle("warn", free < 300 * 1048576);
      });
    } catch(e){}
  }
  document.getElementById("libSearch").addEventListener("input", function(){ libQuery = this.value; renderRecent(); });

  // Opciones de cada juego (⋯)
  function openGameSheet(it, s){
    var w = document.getElementById("gameSheet");
    document.getElementById("gsName").textContent = it.name.replace(/\.[^.]+$/, "");
    document.getElementById("gsInfo").textContent = [(SYSINFO[it.sys] || SYSINFO.gba).name,
      it.playTime ? "Jugado " + dur(it.playTime) : "Sin tiempo de juego registrado",
      "Copia del juego: " + mb(s.rom), "Guardados rápidos y continuar: " + mb(s.extra)].join("\n");
    document.getElementById("gsFav").textContent = it.fav ? "Quitar de favoritos" : "Marcar como favorito";
    document.getElementById("gsFav").onclick = function(){ Recent.update(it.id, function(r){ r.fav = !r.fav; }).then(function(){ w.classList.remove("show"); renderRecent(); }); };
    var armedX = false, armedR = false;
    // Portada: elegir una imagen propia (se reduce para no ocupar espacio)
    var cv = document.getElementById("gsCover"), cvr = document.getElementById("gsCoverReset");
    cv.textContent = it.cover ? "Cambiar portada" : "Elegir portada";
    cvr.style.display = it.cover ? "" : "none";
    cv.onclick = function(){ var f = document.getElementById("coverFile"); f.value = ""; f.onchange = function(){
      var file = this.files[0]; if (!file) return;
      createImageBitmap(file).then(function(bm){
        var k = Math.min(1, 512 / Math.max(bm.width, bm.height)), c = document.createElement("canvas");
        c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
        c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
        c.toBlob(function(b){
          Recent.update(it.id, function(r){ r.cover = b; }).then(function(){ w.classList.remove("show"); renderRecent(); showOk("Portada cambiada."); });
        }, "image/jpeg", 0.88);
      }).catch(function(){ showErr("No se pudo leer esa imagen. Prueba con una foto JPG o PNG."); });
    }; f.click(); };
    cvr.onclick = function(){ Recent.update(it.id, function(r){ delete r.cover; }).then(function(){ w.classList.remove("show"); renderRecent(); showOk("Vuelve a usarse la portada automática."); }); };
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
          delete mm.cover;
          if (m.cover){ mm.coverFile = "_emulador/portadas/" + i + ".jpg"; files.push({name: mm.coverFile, data: m.cover}); }
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
          return zip(entries.concat(files)).then(function(z){ return new File([z], "copia-emulador-zeta-" + (full ? "" : "partidas-") + stamp + ".zip", {type:"application/zip"}); });
        });
      });
    }
    var ready = null;
    function share(file){
      if (navigator.canShare && navigator.canShare({files:[file]})){
        return navigator.share({files:[file], title:"Copia de Emulador Zeta"}).then(function(){ ready = null; resetBtn(); }).catch(function(e){
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
              meta: (man.meta || []).map(function(m){ var mm = Object.assign({}, m); mm.thumb = blob(m.thumbFile, "image/png"); delete mm.thumbFile; mm.cover = blob(m.coverFile, "image/jpeg"); delete mm.coverFile; if (!mm.cover) delete mm.cover; return mm; }),
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
        "." + (r.games ? " Si un juego aparece como «Falta el archivo del juego», tócalo y elígelo." : ""));
    })
      .catch(function(){ showErr("Ese archivo no parece una copia de partidas válida."); });
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
    navigator.serviceWorker.register("sw.js", {updateViaCache: "none"}).then(function(reg){
      // al volver a la app, comprobar si hay versión nueva
      document.addEventListener("visibilitychange", function(){ if (!document.hidden) reg.update().catch(function(){}); });
    }).catch(function(){});
    // Cuando llega una versión nueva y no estás jugando, la app se recarga sola para mostrarla
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function(){
      if (!hadController){ hadController = true; return; }
      if (!started) location.reload();
    });
  }

  var started = false, CURRENT_ID = null;
  function start(file, chosen){
    if (started) return;
    var detected = sysFromName(file.name);
    var p;
    if (detected==="gba" || detected==="nds" || detected==="n64") p = Promise.resolve(detected);
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
    patchEngine();
    // N64: ParaLLEl es el motor que funciona tanto con gráficos compatibles (iPhone) como modernos
    var core = sys==="gba" ? "mgba" : sys==="n64" ? "parallel_n64" : dsCore;
    document.getElementById("home").style.display="none";
    var aura = document.getElementById("aura"); if (aura) aura.remove();          // no gastar batería con el fondo animado
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
    window.EJS_color = "#ff7417";
    window.EJS_startOnLoaded = false;    // el toque en "Jugar" desbloquea el audio
    window.EJS_startButtonName = "Jugar";
    window.EJS_backgroundColor = "#000";
    window.EJS_Buttons = { netplay:false, cheat:false, cacheManager:false, exitEmulation:false, fullscreen:false, screenRecord:false, quickSave:false, quickLoad:false, screenshot:false, contextMenu:false };
    window.EJS_defaultOptions = { "save-state-location": "browser", "desmume_pointer_type": "touch", "melonds_touch_mode": "Touch", "desmume_hybrid_showboth_screens": "disabled" };
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
  function key(k, v){ var g = gm(); if (g) try { (g.__sim || g.simulateInput).call(g, 0, k, k >= 16 && v === 1 ? 0x7fff : v); } catch(e){} }
  function T(){ return SYS === "n64" ? (prefs.turbo64 = prefs.turbo64 || {}) : prefs.turbo; }

  function toast(msg, ms){ var t=el("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(function(){t.classList.remove("show");}, ms || 1600); }

  /* ---------- Preferencias (se recuerdan en este dispositivo) ---------- */
  var PREF_DEF = { dsLand:"side", frameskip:"off", autoDim:true, landMode:"normal", ff:"3.0", filter:"sharp", dsMode:"normal", padSize:100, padOp:100, turbo:{}, offsets:{portrait:{}, landscape:{}}, silentSound:true, haptics:true };
  var prefs = (function(){ try { return Object.assign({}, PREF_DEF, JSON.parse(store.get("prefs") || "{}")); } catch(e){ return Object.assign({}, PREF_DEF); } })();
  if (!prefs.offsets || !prefs.offsets.portrait) prefs.offsets = {portrait:{}, landscape:{}};
  function savePrefs(){ store.set("prefs", JSON.stringify(prefs)); }

  // iPhone: por defecto Safari silencia las webs con el interruptor de silencio. "playback" hace que suene igualmente.
  function applyAudioSession(){
    try { if (navigator.audioSession) navigator.audioSession.type = prefs.silentSound ? "playback" : "auto"; } catch(e){}
  }

  // Vibración mínima al pulsar. iPhone (iOS 18+): truco del interruptor nativo; Android: vibrate().
  // En iPhone el sistema solo deja vibrar dentro de un gesto "completo" (al levantar el dedo), no al
  // empezar el toque: por eso allí la vibración se lanza en touchend, y en Android al pulsar.
  var HAP_IOS = !navigator.vibrate;
  function hap(){ if (!HAP_IOS) hapNow(); }
  document.addEventListener("touchend", function(e){
    if (!started || !HAP_IOS || !e.target.closest) return;
    if (e.target.closest("#pad > *") && !document.getElementById("play").classList.contains("editing")) hapNow();
  }, true);
  function hapNow(){
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
  // Horizontal "pantalla grande": una pantalla grande y la otra pequeña a su derecha (modo híbrido del motor)
  function dsHybrid(){ return SYS === "nds" && landscape && prefs.dsLand === "big" && !dsSingle(); }
  var hybridGeo = null;        // {w,h} del fotograma real, medido al activar el modo
  function hybSmall(){ return CORE === "melonds" ? [0.5, 1] : [0.495, 0.83]; }     // alto ocupado por la pantalla pequeña (fracción)
  function hybBig(){ return CORE === "melonds" ? 512 / (hybridGeo ? hybridGeo.w : 772) : 0.75; }
  function aspect(){ return SYS==="n64" ? 4/3 : SYS==="gba" ? 3/2 : dsSingle() ? 4/3 : dsHybrid() ? (hybridGeo ? hybridGeo.w / hybridGeo.h : (CORE === "melonds" ? 2 : 16/9)) : (landscape ? 8/3 : 2/3); }
  function nativeW(){ return SYS==="n64" ? 320 : SYS==="gba" ? 240 : (landscape && !dsSingle()) ? 512 : 256; }

  function applyDsLayout(){
    if (SYS!=="nds" || !gm()) return;
    var m = prefs.dsMode, mel = CORE==="melonds", v;
    if (dsHybrid()){
      var bigBottom = m === "swap";
      v = mel ? (bigBottom ? "Hybrid Bottom" : "Hybrid Top") : (bigBottom ? "hybrid/bottom" : "hybrid/top");
      try { if (mel) gm().setVariable("melonds_hybrid_small_screen", bigBottom ? "Top" : "Bottom"); else gm().setVariable("desmume_hybrid_showboth_screens", "disabled"); } catch(e){}
      try { gm().setVariable(mel ? "melonds_screen_layout" : "desmume_screens_layout", v); } catch(e){}
      measureHybrid();
      return;
    }
    if (m === "top") v = mel ? "Top Only" : "top only";
    else if (m === "bottom") v = mel ? "Bottom Only" : "bottom only";
    else if (m === "swap") v = landscape ? (mel ? "Right/Left" : "right/left") : (mel ? "Bottom/Top" : "bottom/top");
    else v = landscape ? (mel ? "Left/Right" : "left/right") : (mel ? "Top/Bottom" : "top/bottom");
    try { gm().setVariable(mel ? "melonds_screen_layout" : "desmume_screens_layout", v); } catch(e){}
  }

  // Mide el tamaño real del fotograma en modo híbrido (cada motor lo compone distinto)
  function measureHybrid(){
    setTimeout(function(){
      var g = gm(); if (!g || !dsHybrid()) return;
      Promise.resolve(g.screenshot()).then(function(png){
        if (!png || png.length < 24) return;
        var dv = new DataView(png.buffer || png, png.byteOffset || 0);
        var w = dv.getUint32(16), h = dv.getUint32(20);
        if (w > 0 && h > 0 && (!hybridGeo || hybridGeo.w !== w || hybridGeo.h !== h)){ hybridGeo = {w:w, h:h}; layout(); }
      }).catch(function(){});
    }, 400);
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
    var hyb = dsHybrid();
    var a = aspect(), sw, sh, sx, sy, m = 10;
    var face = el("face"), dpad = el("dpad");

    if (!landscape){
      // Vertical: pantalla arriba a todo el ancho, mandos debajo
      var topGap = 14;                                 // iOS difumina el borde superior: un poco de aire
      var maxH = H - 230 - topGap;                     // deja sitio mínimo para los mandos
      sw = W; sh = W / a;
      if (sh > maxH){ sh = Math.max(maxH, H*0.45); sw = sh * a; if (sw > W){ sw = W; sh = W/a; } }
      sx = (W - sw)/2; sy = topGap;
      var top = sy + sh, ph = H - top;                 // zona de mandos
      var size = Math.max(112, Math.min(170, ph - 120, W*0.42));
      var cy = top + 56 + Math.min((ph - 56 - 56)/2, size/2 + 40);             // centro vertical entre la fila L/R y la fila inferior
      place(el("bL"), {left:m, top:top+8});
      place(el("bR"), {right:m, top:top+8});
      place(dpad, {left:m+4, top:cy-size/2, width:size, height:size});
      place(el("stick"), {left:m+4, top:cy-size/2, width:size, height:size});
      if (SYS === "n64"){        // N64: stick arriba y cruceta debajo
        var ss = Math.min(size, 140), dd = Math.round(ss * 0.72);
        place(el("stick"), {left:m+4, top:cy-ss/2-dd/2-4, width:ss, height:ss});
        place(dpad, {left:m+4+(ss-dd)/2, top:cy+ss/2-dd/2+10, width:dd, height:dd});
      }
      place(face, {right:m+4, top:cy-size/2, width:size, height:size});
      var by = 12;
      place(el("bBack"), {left:m, bottom:by});
      place(el("bSel"), {left:W/2-86, bottom:by-3+3});
      place(el("bSta"), {left:W/2+8, bottom:by});
      place(el("bFF"), {right:m+48, bottom:by});
      place(el("bMenu"), {right:m, bottom:by});
      place(el("bMic"), {left:W/2-20, top:top+8});
    } else if (hyb){
      // DS horizontal "pantalla grande": imagen a la izquierda a toda la altura; mandos por encima, como una consola
      sh = H; sw = H * a; if (sw > W - 120){ sw = W - 120; sh = sw / a; }
      sx = 0; sy = (H - sh) / 2;
      var bigW = sw * hybBig();                                // ancho de la pantalla grande dentro de la imagen
      var smTop = sy + sh * hybSmall()[0];                     // la pantalla pequeña queda a la derecha, en la mitad de abajo
      var fs = Math.max(104, Math.min(150, W - sw - 6, H * 0.4));
      var ds = Math.max(110, Math.min(150, H * 0.38));
      var tx = bigW + 8;                                       // zona libre arriba a la derecha, encima de la pantalla pequeña
      place(el("bL"), {left:m, top:m});
      place(el("bR"), {right:m, top:m});
      place(el("bMenu"), {left:tx, top:m});
      place(el("bFF"), {left:tx + 48, top:m});
      place(el("bSel"), {left:tx, top:m + 50});
      place(el("bSta"), {left:tx + 84, top:m + 50});
      place(el("bMic"), {left:tx, top:Math.min(m + 96, smTop - 46)});
      place(dpad, {left:m + 6, top:H - ds - m - 4, width:ds, height:ds});
      place(face, {right:m, top:H - fs - m, width:fs, height:fs});
      place(el("bBack"), {left:m + ds + 20, bottom:m});
      place(el("stick"), {left:m, top:m, width:0, height:0});
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
      place(el("stick"), {left:(col-size2)/2, top:(H-size2)/2+6, width:size2, height:size2});
      if (SYS === "n64"){
        var s2 = Math.min(size2, (H - 120) * 0.56), d2 = Math.round(s2 * 0.7);
        place(el("stick"), {left:(col-s2)/2, top:56, width:s2, height:s2});
        place(dpad, {left:(col-d2)/2, top:56 + s2 + 8, width:d2, height:d2});
      }
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
    var sep = el("dsSep");
    if (SYS === "nds" && !dsSingle()){
      sep.style.display = "block";
      if (hyb){ var bw = sw * hybBig();
        place(sep, {left: sx + bw, top: sy + sh * hybSmall()[0], width: 1, height: sh * (hybSmall()[1] - hybSmall()[0])}); }
      else if (landscape) place(sep, {left: sx + sw/2, top: sy, width: 1, height: sh});
      else place(sep, {left: sx, top: sy + sh/2, width: sw, height: 1});
    } else sep.style.display = "none";
    layoutFace();
    applyPadPrefs();
  }

  // Tamaño, opacidad y posición de los botones elegidos por el usuario (por orientación)
  var CTRLS = ["bL","bR","dpad","stick","face","bSel","bSta","bFF","bMenu","bBack","bMic"];
  function applyPadPrefs(){
    var sc = (prefs.padSize || 100) / 100, offs = prefs.offsets[landscape ? "landscape" : "portrait"] || {};
    CTRLS.forEach(function(id){
      var n = el(id), o = offs[id] || [0,0];
      n.style.translate = o[0] + "px " + o[1] + "px";
      n.style.scale = String(sc);
    });
    pad.style.opacity = String((prefs.padOp || 100) / 100);
    pad.classList.toggle("dim", !!prefs.autoDim && landscape && ((SYS === "gba" && prefs.landMode !== "normal") || dsHybrid()));
  }

  // Botones de acción: GBA = A/B en diagonal; DS = rombo X/A/B/Y
  var faceBtns = [];
  function buildFace(){
    var face = el("face"); face.innerHTML = "";
    var defs = SYS==="n64"
      ? [{t:"A",k:0,x:.52,y:.86,rf:.19},{t:"B",k:1,x:.17,y:.6,rf:.19},
         {t:"▲",k:23,x:.72,y:.1,rf:.125},{t:"◀",k:21,x:.52,y:.32,rf:.125},{t:"▶",k:20,x:.92,y:.32,rf:.125},{t:"▼",k:22,x:.72,y:.54,rf:.125}]
      : SYS==="gba"
      ? [{t:"A",k:8,x:.74,y:.36},{t:"B",k:0,x:.26,y:.64}]
      : [{t:"X",k:9,x:.5,y:.2},{t:"A",k:8,x:.8,y:.5},{t:"B",k:0,x:.5,y:.8},{t:"Y",k:1,x:.2,y:.5}];
    faceBtns = defs.map(function(d){ var b=document.createElement("div"); b.className="vb fb"; b.textContent=d.t; face.appendChild(b); d.el=b; return d; });
  }
  function layoutFace(){
    var face = el("face"), S = face.clientWidth || 150;
    var r = SYS==="gba" ? S*0.24 : S*0.19;
    faceBtns.forEach(function(d){ d.r = d.rf ? S*d.rf : r; var r2 = d.r; d.el.style.fontSize = d.rf && d.rf < .15 ? "13px" : ""; d.el.classList.toggle("cbtn", !!(d.rf && d.rf < .15)); place(d.el,{left:d.x*S-r2, top:d.y*S-r2, width:r2*2, height:r2*2}); });
  }

  // Stick analógico de N64 (16 derecha, 17 izquierda, 18 abajo, 19 arriba; valor 0..0x7fff)
  var stickLast = [0,0,0,0];
  function stickSet(x, y){
    var vals = [x > 0 ? x : 0, x < 0 ? -x : 0, y > 0 ? y : 0, y < 0 ? -y : 0].map(function(v){ return Math.round(Math.min(1, v) * 0x7fff); });
    vals.forEach(function(v, i){ if (v !== stickLast[i]){ stickLast[i] = v; if (SYS === "n64") key(16 + i, v); } });
    var knob = el("stick").firstElementChild; if (knob) knob.style.transform = "translate(" + (x * 28) + "%," + (y * 28) + "%)";
  }
  function bindStick(){
    var st = el("stick"), id = null;
    var move = function(e){
      var rc = st.getBoundingClientRect(), R = rc.width * 0.36;
      var dx = (e.clientX - (rc.left + rc.width/2)) / R, dy = (e.clientY - (rc.top + rc.height/2)) / R, d = Math.hypot(dx, dy);
      if (d > 1){ dx /= d; dy /= d; }
      if (d < 0.14){ dx = 0; dy = 0; }
      stickSet(dx, dy);
    };
    st.addEventListener("pointerdown", function(e){ e.preventDefault(); id = e.pointerId; try{st.setPointerCapture(id);}catch(_){} move(e); });
    st.addEventListener("pointermove", function(e){ if (e.pointerId === id) move(e); });
    var end = function(e){ if (e.pointerId === id){ id = null; stickSet(0, 0); } };
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end); st.addEventListener("lostpointercapture", end);
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
        if (!T()[b.k] || !v) key(b.k, v);          // con turbo, la pulsación la da el bucle de abajo
      }
      b.el.classList.toggle("on", !!v);
    });
  }
  // Pulsaciones que llegan del mando Bluetooth o del teclado (las gestiona EmulatorJS)
  var extHeld = {};
  function hookExternalInput(){
    var g = gm(); if (!g || g.__sim) return;
    g.__sim = g.simulateInput;
    g.simulateInput = function(p, k, v){
      if (p === 0 && (k === 8 || k === 0 || k === 1) && T()[k]){
        extHeld[k] = v > 0;
        if (!v) g.__sim.call(g, p, k, 0);
        return;                                    // con turbo activado, la pulsación la hace el bucle de turbo
      }
      return g.__sim.call(g, p, k, v);
    };
  }
  // Turbo: mientras se mantiene el botón, se pulsa y suelta solo ~10 veces por segundo
  var turboPhase = 0;
  setInterval(function(){
    if (!gameStarted) return;
    turboPhase ^= 1;
    var tt = T(); Object.keys(tt).forEach(function(k){ if (tt[k] && (faceState[k] || extHeld[k])) key(+k, turboPhase); });
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
  // iOS hace zoom con un doble toque rápido aunque la página lo prohíba: lo bloqueamos durante el juego
  var lastTouchEnd = 0;
  document.addEventListener("touchend", function(e){
    if (!started) return;
    var now = Date.now();
    if (now - lastTouchEnd < 350 && e.cancelable && !e.target.closest(".sheet, #errbox, #cont, #editbar")) e.preventDefault();
    lastTouchEnd = now;
  }, {passive:false});
  ["gesturestart","gesturechange","dblclick"].forEach(function(ev){
    document.addEventListener(ev, function(e){ if (started) e.preventDefault(); }, {passive:false});
  });
  // iOS muestra una lupa al mantener pulsado o pulsar muchas veces: se evita en los mandos
  pad.addEventListener("touchstart", function(e){ if (e.cancelable) e.preventDefault(); }, {passive:false});
  pad.addEventListener("touchmove", function(e){ if (e.cancelable) e.preventDefault(); }, {passive:false});
  document.addEventListener("selectstart", function(e){ if (started && !(e.target.closest && e.target.closest("input, textarea"))) e.preventDefault(); });
  var releasers = [];
  // Red de seguridad contra botones "atascados": si iOS no avisa de que se ha levantado un dedo
  // (gestos del sistema, notificaciones…), al no quedar ningún dedo en la pantalla se suelta todo.
  ["touchend", "touchcancel"].forEach(function(ev){
    document.addEventListener(ev, function(e){ if (gameStarted && e.touches && e.touches.length === 0) releaseAll(); }, true);
  });
  window.addEventListener("blur", function(){ if (gameStarted) releaseAll(); });
  function releaseAll(){       // suelta todo lo pulsado (evita teclas "atascadas" al volver)
    setDirs({u:0,d:0,l:0,r:0}); stickSet(0, 0);
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
    hookExternalInput();
    setTimeout(applyCheats, 800);
    applyFF(); applyFilter(); applyFrameskip();
    // DS: la pantalla táctil funciona con el dedo (por defecto los motores esperan un ratón)
    if (SYS === "nds") try {
      if (CORE === "melonds") gm().setVariable("melonds_touch_mode", "Touch");
      else gm().setVariable("desmume_pointer_type", "touch");
    } catch(e){}
    if (CORE === "melonds") try { gm().setVariable("melonds_mic_input", "Blow Noise"); } catch(e){}
    setTimeout(saveThumb, 4000);
    perfWatch();
  }
  function applyFrameskip(){
    var f = prefs.frameskip || "off", g = gm(); if (!g) return;
    try {
      if (CORE === "mgba"){
        g.setVariable("mgba_frameskip", f === "off" ? "disabled" : f === "auto" ? "auto" : "fixed_interval");
        if (f === "1" || f === "2") g.setVariable("mgba_frameskip_interval", f);
      } else if (CORE === "desmume2015"){
        g.setVariable("desmume_frameskip", f === "off" ? "0" : f === "auto" ? "1" : f);
      }
    } catch(e){}
  }
  function frameskipSupported(){ return CORE === "mgba" || CORE === "desmume2015"; }
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
            : frameskipSupported() ? "El juego va lento. En ☰ › Saltar fotogramas puedes elegir «Auto» o «1»."
            : "Este juego exige mucho al móvil. Prueba a cerrar otras apps o a usar gráficos «Compatible».", 6000);
        }
      }
      last = {f: f, t: now};
    }, 4000);
  }

  /* ---------- Menú ☰ ---------- */
  var sheetPaused = false, keepPaused = false;
  function anySheet(){ return ["sheet","adv","cheats"].some(function(id){ return el(id).classList.contains("show"); }); }
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
    document.documentElement.style.setProperty("--kb", "0px"); fixScroll();
    el("sheet").classList.add("show"); renderSlots();
    shot().then(function(b){ menuShot = b; if (el("sheet").classList.contains("show")) pauseForSheet(); });
  }
  function closeSheets(){
    el("sheet").classList.remove("show"); el("cheats").classList.remove("show");
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
    paintSegV("dsLandSeg", prefs.dsLand);
    paintSegV("fsSeg", prefs.frameskip || "off");
    el("fsOpts").style.display = frameskipSupported() ? "" : "none";
    var fa = document.querySelector('#fsSeg [data-v="auto"]'); if (fa) fa.style.display = CORE === "mgba" ? "" : "none";
    el("landOpts").style.display = SYS === "gba" ? "" : "none";
    if (SYS === "n64") document.querySelectorAll('#filterSeg [data-v="lcd"]').forEach(function(b){ b.style.display = "none"; });
    document.querySelectorAll("#turboSeg button").forEach(function(b){ b.classList.toggle("on", !!T()[b.dataset.k]); });
    document.querySelectorAll("#optSeg button, #optSeg2 button").forEach(function(b){ b.classList.toggle("on", !!prefs[b.dataset.o]); });
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
      d.innerHTML = '<div class="pic">Ranura ' + n + '</div><div class="when">Vacía</div><div class="bt"><button data-a="save">Guardar</button><button data-a="load" disabled>Cargar</button><button data-a="del" class="del" hidden>Borrar</button></div>';
      box.appendChild(d);
      Recent.getSlot(CURRENT_ID, n).then(function(rec){
        if (!rec) return;
        d.querySelector(".when").textContent = ago(rec.ts);
        d.querySelector('[data-a="load"]').disabled = false;
        d.querySelector('[data-a="del"]').hidden = false;
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
      var armedDel = false, td;
      d.querySelector('[data-a="del"]').onclick = function(){
        var btn = this;
        if (!armedDel){ armedDel = true; btn.textContent = "¿Seguro?"; clearTimeout(td); td = setTimeout(function(){ armedDel = false; btn.textContent = "Borrar"; }, 2500); return; }
        Recent.delSlot(CURRENT_ID, n).then(function(){ toast("Ranura " + n + " borrada"); renderSlots(); }).catch(function(){ toast("No se pudo borrar"); });
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
    ["sheet","adv","cheats"].forEach(function(id){
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
    el("mShot").onclick = shareShot;
    el("mCheats").onclick = openCheats;
    el("cheatAdd").onclick = addCheat;
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
    document.querySelectorAll("#optSeg button, #optSeg2 button").forEach(function(b){ b.onclick = function(){
      if (b.dataset.o === "autoDim"){ prefs.autoDim = !prefs.autoDim; savePrefs(); paintMenu(); applyPadPrefs(); return; }
      prefs[b.dataset.o] = !prefs[b.dataset.o]; savePrefs(); paintMenu();
      if (b.dataset.o === "silentSound") applyAudioSession();
      if (b.dataset.o === "haptics" && prefs.haptics) hapNow();
    }; });
    document.querySelectorAll("#ffSeg button").forEach(function(b){ b.onclick = function(){ prefs.ff = b.dataset.v; savePrefs(); applyFF(); paintMenu(); }; });
    document.querySelectorAll("#filterSeg button").forEach(function(b){ b.onclick = function(){ prefs.filter = b.dataset.v; savePrefs(); applyFilter(); paintMenu(); }; });
    document.querySelectorAll("#dsLandSeg button").forEach(function(b){ b.onclick = function(){ prefs.dsLand = b.dataset.v; savePrefs(); hybridGeo = null; applyDsLayout(); layout(); paintMenu();
      if (!landscape) toast("Se verá al girar el móvil en horizontal"); }; });
    document.querySelectorAll("#fsSeg button").forEach(function(b){ b.onclick = function(){ prefs.frameskip = b.dataset.v; savePrefs(); applyFrameskip(); paintMenu(); }; });
    document.querySelectorAll("#landSeg button").forEach(function(b){ b.onclick = function(){ prefs.landMode = b.dataset.v; savePrefs(); layout(); paintMenu();
      if (!landscape) toast("Se verá al girar el móvil en horizontal"); }; });
    document.querySelectorAll("#dsSeg button").forEach(function(b){ b.onclick = function(){ prefs.dsMode = b.dataset.v; savePrefs(); hybridGeo = null; applyDsLayout(); layout(); paintMenu(); }; });
    document.querySelectorAll("#turboSeg button").forEach(function(b){ b.onclick = function(){ T()[b.dataset.k] = !T()[b.dataset.k]; savePrefs(); paintMenu(); }; });
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

  /* ---------- Ajustes del motor antes de arrancar ---------- */
  function patchEngine(){
    var tries = 0, t = setInterval(function(){
      tries++;
      // Sin el aviso "Fast-Forward" en pantalla (ya se ve en el botón »)
      if (window.EJS_GameManager && !window.EJS_GameManager.__zeta){
        var P = window.EJS_GameManager.prototype, orig = P.getRetroArchCfg;
        P.getRetroArchCfg = function(){ return orig.call(this) + "notification_show_fast_forward = \"false\"\n"; };
        window.EJS_GameManager.__zeta = true;
      }
      // Errores al abrir un juego: mensaje propio en español
      if (window.EmulatorJS && !window.EmulatorJS.__zeta){
        var EP = window.EmulatorJS.prototype, origErr = EP.startGameError;
        EP.startGameError = function(msg){ try { origErr.call(this, msg); } catch(e){} showGameError(msg); };
        window.EmulatorJS.__zeta = true;
      }
      if ((window.EJS_GameManager && window.EmulatorJS) || tries > 600) clearInterval(t);
    }, 25);
  }
  function showGameError(msg){
    var m = String(msg || ""), txt;
    if (/red|network/i.test(m)) txt = "No se pudo descargar una parte del emulador. Comprueba tu conexión e inténtalo de nuevo.";
    else if (/gráficos|graphics/i.test(m)) txt = "Tu navegador no ha podido iniciar los gráficos. Prueba a cambiar «Gráficos» en la pantalla de inicio.";
    else if (/núcleo|core/i.test(m)) txt = "No se pudo cargar el motor del emulador. Comprueba tu conexión e inténtalo de nuevo.";
    else txt = "El archivo puede estar dañado o no ser un juego de " + (SYS === "gba" ? "GBA, GB o GBC" : SYSINFO[SYS].name) + "." +
      (SYS === "nds" ? "\nTambién puedes probar el otro motor de DS en la pantalla de inicio." : "");
    el("errMsg").textContent = txt;
    el("errbox").classList.add("show");
    el("errBack").onclick = function(){ location.reload(); };
  }

  /* ---------- Captura de pantalla para compartir ---------- */
  // "¡Estoy jugando a Pokemon Mystery Dungeon - Red Rescue Team en Game Boy Advance con Emulador Zeta!"
  function shareText(){
    var file = (CURRENT_ID || "").split(":").slice(1, -1).join(":");
    var game = file.replace(/\.[^.]+$/, "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+/g, " ").trim() || "un juego";
    var ext = (file.split(".").pop() || "").toLowerCase();
    var consoleName = SYS === "n64" ? "Nintendo 64" : SYS === "nds" ? "Nintendo DS" : ext === "gb" ? "Game Boy" : ext === "gbc" ? "Game Boy Color" : "Game Boy Advance";
    return "¡Estoy jugando a " + game + " en " + consoleName + " con Emulador Zeta!";
  }
  function shareShot(){
    var src = menuShot;
    if (!src){ toast("No se pudo hacer la captura. Cierra el menú, deja correr el juego un momento y vuelve a probar.", 3500); return; }
    createImageBitmap(src).then(function(bm){
      var k = Math.max(2, Math.round(1080 / Math.max(bm.width, bm.height)));      // ampliada sin difuminar
      var c = document.createElement("canvas"); c.width = bm.width * k; c.height = bm.height * k;
      var x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(bm, 0, 0, c.width, c.height);
      c.toBlob(function(b){
        var d = new Date(), nm = shareText().replace(/^¡Estoy jugando a | en .*$/g, "").slice(0, 60) + " " + d.toISOString().slice(0, 10) + ".png";
        var f = new File([b], nm, {type:"image/png"});
        if (navigator.canShare && navigator.canShare({files:[f]})) navigator.share({files:[f], text: shareText()}).catch(function(){});
        else { var a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = nm; document.body.appendChild(a); a.click(); setTimeout(function(){ a.remove(); }, 3000); }
      }, "image/png");
    }).catch(function(){ toast("No se pudo hacer la captura"); });
  }

  /* ---------- Trucos (se guardan por juego) ---------- */
  var cheats = [];
  function loadCheats(){
    return Recent.list().then(function(items){
      var me = items.filter(function(i){ return i.id === CURRENT_ID; })[0];
      cheats = (me && me.cheats) || []; return cheats;
    });
  }
  function saveCheats(){ return Recent.update(CURRENT_ID, function(r){ r.cheats = cheats; }); }
  // mGBA solo entiende líneas "XXXXXXXX YYYYYYYY" (GameShark / Action Replay) o "XXXXXXXX YYYY" (CodeBreaker)
  // unidas con "+". Se limpia lo que escriba el usuario: sin espacio, con guiones, todo seguido, etc.
  function cheatLines(code){
    var out = [];
    String(code).toUpperCase().split(/[\n+;,]+/).forEach(function(line){
      var hex = line.replace(/[^0-9A-F]/g, "");
      if (!hex) return;
      if (hex.length === 12){ out.push(hex.slice(0, 8) + " " + hex.slice(8)); return; }
      if (hex.length % 16 === 0){ for (var i = 0; i < hex.length; i += 16) out.push(hex.slice(i, i + 8) + " " + hex.slice(i + 8, i + 16)); return; }
      if (hex.length % 12 === 0){ for (var j = 0; j < hex.length; j += 12) out.push(hex.slice(j, j + 8) + " " + hex.slice(j + 8, j + 12)); return; }
      out.push(null);                         // línea que no cuadra con ningún formato
    });
    return out;
  }
  function cheatFormat(code){
    var lines = cheatLines(code).filter(Boolean);
    return SYS === "gba" && CORE === "mgba" ? lines.join("+") : lines.join("\n");
  }
  function applyCheats(){
    loadCheats().then(function(){
      var g = gm(); if (!g) return;
      try { g.resetCheat(); } catch(e){}
      var n = 0;
      cheats.forEach(function(c){ if (c.on) try { g.setCheat(n++, 1, cheatFormat(c.code)); } catch(e){} });
    });
  }
  function renderCheats(){
    var box = el("cheatList"); box.innerHTML = "";
    if (!cheats.length){ box.innerHTML = '<div class="nocheat">Todavía no has añadido trucos para este juego.</div>'; return; }
    cheats.forEach(function(c, i){
      var r = document.createElement("div"); r.className = "cheat";
      r.innerHTML = '<div class="cn"><b></b><code></code></div><button class="tg"></button><button class="del">Borrar</button>';
      r.querySelector("b").textContent = c.name; r.querySelector("code").textContent = c.code.replace(/\n/g, " ");
      var tg = r.querySelector(".tg"); tg.textContent = c.on ? "Activo" : "Apagado"; tg.classList.toggle("on", !!c.on);
      tg.onclick = function(){ c.on = !c.on; saveCheats().then(applyCheats); renderCheats(); };
      var armed = false;
      r.querySelector(".del").onclick = function(){
        if (!armed){ armed = true; this.textContent = "¿Seguro?"; return; }
        cheats.splice(i, 1); saveCheats().then(applyCheats); renderCheats();
      };
      box.appendChild(r);
    });
  }
  if (window.visualViewport){
    var kb = function(){
      var v = window.visualViewport, a = document.activeElement;
      var typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== "range" && a.type !== "file" && a.closest(".sheet");
      var h = typing ? Math.max(0, window.innerHeight - v.height - v.offsetTop) : 0;
      if (h < 80) h = 0;
      document.documentElement.style.setProperty("--kb", h + "px");
      if (h){ var body = a.closest(".sh-body"); if (body) setTimeout(function(){ body.scrollTop += a.getBoundingClientRect().top - body.getBoundingClientRect().top - 40; }, 60); }
      else fixScroll();
    };
    visualViewport.addEventListener("resize", kb); visualViewport.addEventListener("scroll", kb);
    document.addEventListener("focusout", function(){ setTimeout(kb, 80); });
    document.addEventListener("focusin", function(){ setTimeout(kb, 80); });
  }
  // Que nada (teclado, foco) deje la pantalla de juego desplazada
  function fixScroll(){
    if (!started) return;                    // solo durante la partida: en el inicio hay que poder deslizar
    try { window.scrollTo(0, 0); el("play").scrollTop = 0; stage.scrollTop = 0; document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch(e){}
  }
  function openCheats(){
    loadCheats().then(function(){ renderCheats(); el("sheet").classList.remove("show"); el("cheats").classList.add("show"); });
  }
  function addCheat(){
    var name = el("cheatName").value.trim(), code = el("cheatCode").value.trim().toUpperCase().replace(/[ \t]+/g, " ").replace(/\n+/g, "\n");
    if (!code){ toast("Escribe el código del truco"); return; }
    var parsed = cheatLines(code);
    if (!parsed.length || parsed.indexOf(null) >= 0){
      toast("Ese código no tiene el formato esperado: cada línea debe tener 16 caracteres (8 + 8) o 12 (8 + 4), solo números y letras de la A a la F.", 6000); return;
    }
    code = parsed.join("\n");
    cheats.push({name: name || "Truco " + (cheats.length + 1), code: code, on: true});
    el("cheatName").value = ""; el("cheatCode").value = "";
    saveCheats().then(applyCheats); renderCheats(); toast("Truco añadido y activado");
  }

  /* ---------- Menú con el mando: cruceta para moverse, A para elegir, B para volver ---------- */
  var gpPrev = {}, gpFocus = -1;
  function gpFocusables(){
    var open = ["cheats","adv","sheet","errbox"].map(el).filter(function(n){ return n.classList.contains("show"); })[0];
    if (!open) return [];
    return Array.prototype.filter.call(open.querySelectorAll("button, input[type=range], .ejs_settings_main_bar, .ejs_option_row, .ejs_back_button"),
      function(n){ return n.offsetParent !== null && !n.disabled; });
  }
  function gpMark(list){
    document.querySelectorAll(".gpfocus").forEach(function(n){ n.classList.remove("gpfocus"); });
    var n = list[gpFocus]; if (!n) return;
    n.classList.add("gpfocus");
    var body = n.closest(".sh-body");
    if (body){ var r = n.getBoundingClientRect(), br = body.getBoundingClientRect();
      if (r.top < br.top) body.scrollTop -= br.top - r.top + 12; else if (r.bottom > br.bottom) body.scrollTop += r.bottom - br.bottom + 12; }
  }
  setInterval(function(){
    if (!gameStarted || !navigator.getGamepads || !anySheet() && !el("errbox").classList.contains("show")){ gpFocus = -1; return; }
    var now = {}, hasPad = false;
    try { Array.prototype.forEach.call(navigator.getGamepads(), function(gp){
      if (!gp || !gp.buttons) return;
      hasPad = true;
      [0,1,12,13,14,15].forEach(function(i){ if (gp.buttons[i] && gp.buttons[i].pressed) now[i] = 1; });
    }); } catch(e){}
    var hit = function(i){ return now[i] && !gpPrev[i]; };
    if (!hasPad){ if (gpFocus >= 0){ gpFocus = -1; gpMark([]); } gpPrev = {}; return; }
    var list = gpFocusables();
    if (list.length){
      if (gpFocus < 0 || gpFocus >= list.length){ gpFocus = 0; gpMark(list); }
      var cur = list[gpFocus];
      if (hit(13)){ gpFocus = Math.min(list.length - 1, gpFocus + 1); gpMark(list); }
      if (hit(12)){ gpFocus = Math.max(0, gpFocus - 1); gpMark(list); }
      if ((hit(14) || hit(15)) && cur && cur.type === "range"){
        cur.value = +cur.value + (hit(15) ? 1 : -1) * (+cur.step || 1); cur.dispatchEvent(new Event("input"));
      } else if (hit(15)){ gpFocus = Math.min(list.length - 1, gpFocus + 1); gpMark(list); }
      else if (hit(14)){ gpFocus = Math.max(0, gpFocus - 1); gpMark(list); }
      if (hit(0) && cur){ cur.click(); gpFocus = -1; setTimeout(function(){ gpMark(gpFocusables()); }, 50); }
    }
    if (hit(1)){
      if (el("cheats").classList.contains("show") || el("adv").classList.contains("show")){ closeSheets(); }
      else closeSheets();
      gpFocus = -1;
    }
    gpPrev = now;
  }, 80);

  // Se iluminan al tocarlos (cuando están atenuados en pantalla completa)
  pad.addEventListener("pointerdown", function(e){
    var n = e.target.closest("#pad > *"); if (!n) return;
    clearTimeout(n.__lt); n.classList.add("lit");
  }, true);
  ["pointerup","pointercancel"].forEach(function(ev){
    pad.addEventListener(ev, function(e){
      var n = e.target.closest("#pad > *"); if (!n) return;
      clearTimeout(n.__lt); n.__lt = setTimeout(function(){ n.classList.remove("lit"); }, 700);
    }, true);
  });

  function setupPad(sys, core){
    SYS = sys; CORE = core;
    pad.className = sys;
    if (sys === "n64"){
      el("bSel").textContent = "Z"; el("bSel").dataset.k = "12";             // N64 no tiene Select: ese botón es el gatillo Z
      var tb = document.querySelectorAll("#turboSeg button"); tb[0].dataset.k = "0"; tb[1].dataset.k = "1";
      el("mCheats").style.display = "none";
    }
    buildFace(); bindDpad(); bindStick(); bindFace();
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
