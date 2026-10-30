(function() {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STORAGE_KEY = 'ninety-two-grounds-v2';
  var LEAGUES = [['PL', 'Premier League', 20], ['CH', 'Championship', 24], ['L1', 'League One', 24], ['L2', 'League Two', 24]];
  var REGIONS = {
    'All': null,
    'London': [92, 330, 36, 40],
    'North West': [-75, 95, 85, 90],
    'Yorkshire': [0, 95, 125, 80],
    'Midlands': [-50, 175, 120, 110],
    'South': [-140, 325, 330, 150]
  };
  var MODE_TEXT = {
    grounds: { placeholder: 'Type a ground, press Enter', intro: 'The clock starts when you type your first letter. Old and sponsor names count.', noun: 'ground' },
    clubs: { placeholder: 'Type a club, press Enter', intro: 'The clock starts when you type your first letter. Common nicknames count.', noun: 'club' }
  };

  // ---- text matching ----

  function normalise(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/['’`.]/g, '')
      .replace(/[^a-z0-9@]+/g, ' ').replace(/\bsaint\b/g, 'st').replace(/\bfc\b|\bafc\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function stripFiller(key) {
    return key.replace(/\b(the|stadium|community|arena)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [];
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var row = [i];
      var low = i;
      for (j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (row[j] < low) low = row[j];
      }
      if (low > max) return max + 1;
      prev = row;
    }
    return prev[b.length];
  }

  function buildIndex(grounds, mode) {
    var index = {};
    function add(key, i) {
      if (key.length < 2) return;
      if (!index[key]) index[key] = [];
      if (index[key].indexOf(i) === -1) index[key].push(i);
    }
    grounds.forEach(function(g, i) {
      var names = mode === 'grounds' ? [g.ground].concat(g.groundAliases) : [g.club].concat(g.clubAliases);
      names.forEach(function(name) {
        var key = normalise(name);
        add(key, i);
        if (mode === 'grounds') add(stripFiller(key), i);
      });
    });
    return index;
  }

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var ss = (s < 10 ? '0' : '') + s;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + ss;
    return m + ':' + ss;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- storage ----

  function loadSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.modes) return saved;
    } catch (e) {}
    return null;
  }

  function emptyMode() {
    return { found: [], gaveUp: false, elapsed: 0, best: null };
  }

  // ---- game ----

  function Game(root, grounds, outline) {
    this.root = root;
    this.grounds = grounds;
    this.outline = outline;
    this.index = { grounds: buildIndex(grounds, 'grounds'), clubs: buildIndex(grounds, 'clubs') };
    this.view = { s: 1, tx: 0, ty: 0 };
    this.fresh = [];
    this.pointers = {};
    this.pinch = null;
    this.startedAt = null;
    this.ticker = null;
    this.paused = false;
    this.state = loadSaved() || { mode: 'grounds', ghosts: false, modes: { grounds: emptyMode(), clubs: emptyMode() } };
    this.findElements();
    this.drawLand();
    this.buildRegions();
    this.bindEvents();
    this.setMode(this.state.mode);
    this.fitAll();
  }

  Game.prototype.findElements = function() {
    var r = this.root;
    this.el = {
      input: r.querySelector('.game-input'),
      form: r.querySelector('.game-form'),
      message: r.querySelector('.game-message'),
      count: r.querySelector('.game-count'),
      timer: r.querySelector('.game-timer'),
      pause: r.querySelector('.game-pause'),
      resume: r.querySelector('.game-resume'),
      map: r.querySelector('.game-map'),
      world: r.querySelector('.game-map-world'),
      land: r.querySelector('.game-map-land'),
      dots: r.querySelector('.game-map-dots'),
      labels: r.querySelector('.game-map-labels'),
      regions: r.querySelector('.game-regions'),
      tooltip: r.querySelector('.game-tooltip'),
      leagues: r.querySelector('.game-leagues'),
      ghosts: r.querySelector('.game-ghosts-input'),
      giveUp: r.querySelector('.game-giveup'),
      reset: r.querySelector('.game-reset'),
      best: r.querySelector('.game-best-value'),
      modes: r.querySelectorAll('.game-mode'),
      zoom: r.querySelectorAll('.game-zoom-button')
    };
  };

  Game.prototype.current = function() {
    return this.state.modes[this.state.mode];
  };

  Game.prototype.save = function() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) {}
  };

  // ---- timer ----

  Game.prototype.elapsed = function() {
    var cur = this.current();
    return cur.elapsed + (this.startedAt ? Date.now() - this.startedAt : 0);
  };

  Game.prototype.isFinished = function() {
    var cur = this.current();
    return cur.gaveUp || cur.found.length === this.grounds.length;
  };

  Game.prototype.startTimer = function() {
    if (this.startedAt || this.isFinished()) return;
    var self = this;
    this.startedAt = Date.now();
    this.paused = false;
    this.ticker = setInterval(function() { self.renderTimer(); }, 250);
    this.renderTimer();
  };

  Game.prototype.stopTimer = function() {
    if (!this.startedAt) return;
    this.current().elapsed = this.elapsed();
    this.startedAt = null;
    clearInterval(this.ticker);
    this.ticker = null;
    this.save();
    this.renderTimer();
  };

  Game.prototype.pause = function() {
    if (!this.startedAt) return;
    this.stopTimer();
    this.paused = true;
    this.renderPaused();
  };

  Game.prototype.resume = function() {
    this.paused = false;
    this.startTimer();
    this.renderPaused();
    if (this.el.input) this.el.input.focus();
  };

  Game.prototype.renderTimer = function() {
    var t = this.el.timer;
    var finished = this.isFinished();
    if (t) {
      t.textContent = formatTime(this.elapsed());
      t.classList.toggle('is-running', !!this.startedAt);
      t.classList.toggle('is-stopped', finished && this.current().found.length === this.grounds.length);
    }
    if (this.el.pause) {
      this.el.pause.disabled = finished || (!this.startedAt && !this.paused);
      this.el.pause.textContent = this.paused ? 'Resume' : 'Pause';
    }
  };

  Game.prototype.renderPaused = function() {
    this.root.classList.toggle('is-paused', this.paused);
    if (this.el.input) this.el.input.disabled = this.paused || this.isFinished();
    this.renderTimer();
  };

  // ---- matching ----

  Game.prototype.lookup = function(raw, fuzzy) {
    var index = this.index[this.state.mode];
    var key = normalise(raw);
    if (!key) return null;
    var hit = index[key] || index[stripFiller(key)];
    if (hit) return hit;
    if (!fuzzy || key.length < 5) return null;
    var max = key.length >= 10 ? 2 : 1;
    var best = null;
    var bestDistance = max + 1;
    Object.keys(index).forEach(function(k) {
      if (k.length < 5) return;
      var d = editDistance(key, k, max);
      if (d < bestDistance) { bestDistance = d; best = index[k]; }
    });
    return best;
  };

  Game.prototype.isPrefixOfAnother = function(key) {
    var keys = Object.keys(this.index[this.state.mode]);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== key && keys[i].indexOf(key) === 0) return true;
    }
    return false;
  };

  Game.prototype.flash = function(cls) {
    var input = this.el.input;
    if (!input) return;
    input.classList.remove('is-good', 'is-bad');
    void input.offsetWidth;
    input.classList.add(cls);
  };

  Game.prototype.accept = function(matches) {
    var cur = this.current();
    var grounds = this.grounds;
    // a name shared by several grounds reveals one per entry, so it has to be typed once for each
    var added = matches.filter(function(i) { return cur.found.indexOf(i) === -1; }).slice(0, 1);
    if (!added.length) {
      this.el.message.textContent = 'Already on the map.';
      this.flash('is-bad');
      this.el.input.select();
      return;
    }
    cur.found = cur.found.concat(added);
    this.fresh = added;
    this.el.input.value = '';
    this.flash('is-good');
    this.el.message.textContent = grounds[added[0]].ground + ' (' + grounds[added[0]].club + ')';
    if (cur.found.length === grounds.length) this.finish();
    this.save();
    this.renderLedger();
    this.renderMap();
    this.fresh = [];
  };

  Game.prototype.finish = function() {
    this.stopTimer();
    var cur = this.current();
    var time = cur.elapsed;
    var isBest = cur.best === null || time < cur.best;
    if (isBest) cur.best = time;
    this.el.message.textContent = 'All 92 in ' + formatTime(time) + (isBest ? '. That\'s a new best.' : '. Your best is ' + formatTime(cur.best) + '.');
    this.el.input.disabled = true;
    this.renderTimer();
  };

  Game.prototype.giveUp = function() {
    var cur = this.current();
    if (cur.gaveUp) return;
    this.stopTimer();
    cur.gaveUp = true;
    this.paused = false;
    this.save();
    this.el.message.textContent = 'You named ' + cur.found.length + ' of 92 in ' + formatTime(cur.elapsed) + '. The rest are in red.';
    this.renderAll();
  };

  Game.prototype.reset = function() {
    this.stopTimer();
    var best = this.current().best;
    this.state.modes[this.state.mode] = emptyMode();
    this.current().best = best;
    this.paused = false;
    this.save();
    this.setMode(this.state.mode);
    this.fitAll();
  };

  Game.prototype.setMode = function(mode) {
    this.stopTimer();
    this.state.mode = mode;
    var cur = this.current();
    this.paused = cur.elapsed > 0 && !this.isFinished();
    this.save();
    Array.prototype.forEach.call(this.el.modes, function(btn) {
      var on = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.el.input.placeholder = MODE_TEXT[mode].placeholder;
    this.el.input.value = '';
    this.el.message.textContent = this.paused ? 'Paused at ' + formatTime(cur.elapsed) + '. Press Resume to carry on.' : MODE_TEXT[mode].intro;
    this.renderAll();
  };

  Game.prototype.renderAll = function() {
    this.renderLedger();
    this.renderMap();
    this.renderPaused();
    if (this.el.ghosts) this.el.ghosts.checked = !!this.state.ghosts;
    if (this.el.best) this.el.best.textContent = this.current().best === null ? 'none yet' : formatTime(this.current().best);
  };

  // ---- ledger ----

  Game.prototype.renderLedger = function() {
    var cur = this.current();
    var mode = this.state.mode;
    var grounds = this.grounds;
    if (this.el.count) this.el.count.textContent = cur.found.length;
    if (this.el.giveUp) this.el.giveUp.disabled = this.isFinished();
    if (!this.el.leagues) return;
    this.el.leagues.innerHTML = LEAGUES.map(function(league) {
      var code = league[0];
      var items = [];
      grounds.forEach(function(g, i) { if (g.league === code) items.push(i); });
      var got = items.filter(function(i) { return cur.found.indexOf(i) !== -1; }).length;
      var rows = items.filter(function(i) { return cur.gaveUp || cur.found.indexOf(i) !== -1; })
        .sort(function(a, b) { return grounds[a].club.localeCompare(grounds[b].club); })
        .map(function(i) {
          var g = grounds[i];
          var main = mode === 'grounds' ? g.ground : g.club;
          var sub = mode === 'grounds' ? g.club : g.ground;
          var cls = cur.found.indexOf(i) === -1 ? ' game-league-miss' : '';
          return '<li class="game-league-item' + cls + '"><span class="game-league-name">' + escapeHtml(main) + '</span><span class="game-league-sub">' + escapeHtml(sub) + '</span></li>';
        }).join('');
      var lc = code.toLowerCase();
      return '<div class="game-league"><h3 class="game-league-title">' + league[1] + '<span class="game-league-count">' + got + '/' + league[2] + '</span></h3>' +
        '<div class="game-meter"><span class="game-meter-fill game-meter-' + lc + '" style="width:' + (got / league[2] * 100) + '%"></span></div>' +
        (rows ? '<ul class="game-league-list">' + rows + '</ul>' : '') + '</div>';
    }).join('');
  };

  // ---- map ----

  Game.prototype.drawLand = function() {
    var land = this.el.land;
    var outline = this.outline;
    if (!land) return;
    Object.keys(outline).forEach(function(id) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', outline[id]);
      path.setAttribute('class', 'game-land' + (id === '372' ? ' game-land-ireland' : ''));
      land.appendChild(path);
    });
  };

  Game.prototype.buildRegions = function() {
    var self = this;
    if (!this.el.regions) return;
    Object.keys(REGIONS).forEach(function(name) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'game-region';
      btn.textContent = name;
      btn.addEventListener('click', function() {
        if (REGIONS[name]) self.fit(REGIONS[name]); else self.fitAll();
      });
      self.el.regions.appendChild(btn);
    });
  };

  Game.prototype.fitAll = function() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.grounds.forEach(function(g) {
      x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x);
      y0 = Math.min(y0, g.y); y1 = Math.max(y1, g.y);
    });
    this.fit([x0 - 25, y0 - 25, x1 - x0 + 50, y1 - y0 + 50]);
  };

  Game.prototype.fit = function(box) {
    var w = this.el.map.clientWidth;
    var h = this.el.map.clientHeight;
    if (!w || !h) return;
    var s = Math.min((w - 48) / box[2], (h - 48) / box[3]);
    this.view = { s: s, tx: w / 2 - (box[0] + box[2] / 2) * s, ty: h / 2 - (box[1] + box[3] / 2) * s };
    this.renderMap();
  };

  Game.prototype.zoomAt = function(factor, cx, cy) {
    var s = Math.max(0.3, Math.min(60, this.view.s * factor));
    var k = s / this.view.s;
    this.view.tx = cx - (cx - this.view.tx) * k;
    this.view.ty = cy - (cy - this.view.ty) * k;
    this.view.s = s;
    this.renderMap();
  };

  Game.prototype.renderMap = function() {
    var el = this.el;
    var view = this.view;
    var cur = this.current();
    var grounds = this.grounds;
    var mode = this.state.mode;
    var fresh = this.fresh;
    var showGhosts = this.state.ghosts;
    if (!el.world) return;
    el.world.setAttribute('transform', 'translate(' + view.tx + ',' + view.ty + ') scale(' + view.s + ')');
    el.dots.textContent = '';
    el.labels.textContent = '';
    var radius = Math.min(7, 3.4 + view.s * 0.35) / view.s;
    var dotFrag = document.createDocumentFragment();
    grounds.forEach(function(g, i) {
      var isFound = cur.found.indexOf(i) !== -1;
      if (!isFound && !cur.gaveUp && !showGhosts) return;
      var c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', g.x);
      c.setAttribute('cy', g.y);
      c.setAttribute('r', radius);
      var cls = 'game-dot';
      if (isFound) cls += ' game-dot-' + g.league.toLowerCase() + (fresh.indexOf(i) !== -1 ? ' game-dot-new' : '');
      else if (cur.gaveUp) cls += ' game-dot-miss';
      else cls = 'game-dot-ghost';
      c.setAttribute('class', cls);
      c.setAttribute('data-index', i);
      dotFrag.appendChild(c);
    });
    el.dots.appendChild(dotFrag);

    // labels: newest first, skipping any that would overlap one already placed
    var order = cur.found.slice().reverse();
    if (cur.gaveUp) grounds.forEach(function(g, i) { if (cur.found.indexOf(i) === -1) order.push(i); });
    var placed = [];
    var width = el.map.clientWidth;
    var fontSize = 12 / view.s;
    var labelFrag = document.createDocumentFragment();
    order.forEach(function(i) {
      var g = grounds[i];
      var name = mode === 'grounds' ? g.ground : g.club;
      var sx = g.x * view.s + view.tx;
      var sy = g.y * view.s + view.ty;
      var w = name.length * 6.6 + 4;
      var left = sx + 7 + w > width - 8;
      var box = left ? [sx - 7 - w, sy - 7, sx - 7, sy + 7] : [sx + 7, sy - 7, sx + 7 + w, sy + 7];
      for (var p = 0; p < placed.length; p++) {
        var b = placed[p];
        if (!(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) return;
      }
      placed.push(box);
      var t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', g.x + (left ? -7 : 7) / view.s);
      t.setAttribute('y', g.y + 4 / view.s);
      if (left) t.setAttribute('text-anchor', 'end');
      t.setAttribute('font-size', fontSize);
      t.setAttribute('stroke-width', 3 / view.s);
      t.setAttribute('class', 'game-label-text' + (cur.found.indexOf(i) === -1 ? ' game-label-miss' : ''));
      t.textContent = name;
      labelFrag.appendChild(t);
    });
    el.labels.appendChild(labelFrag);
  };

  Game.prototype.showTooltip = function(e) {
    var tip = this.el.tooltip;
    if (!tip) return;
    var dot = e.target.closest ? e.target.closest('circle') : null;
    if (!dot || dot.getAttribute('class') === 'game-dot-ghost') { tip.classList.remove('is-visible'); return; }
    var g = this.grounds[+dot.getAttribute('data-index')];
    var league = LEAGUES.filter(function(l) { return l[0] === g.league; })[0][1];
    var rect = this.el.map.getBoundingClientRect();
    tip.innerHTML = '<strong>' + escapeHtml(g.ground) + '</strong>' + escapeHtml(g.club) + ' &middot; ' + league;
    tip.style.left = Math.min(e.clientX - rect.left + 12, rect.width - 220) + 'px';
    tip.style.top = (e.clientY - rect.top + 12) + 'px';
    tip.classList.add('is-visible');
  };

  // ---- events ----

  Game.prototype.bindEvents = function() {
    var self = this;
    var el = this.el;

    if (el.input) {
      el.input.addEventListener('input', function() { self.onInput(); });
    }
    if (el.form) {
      el.form.addEventListener('submit', function(e) { e.preventDefault(); self.onSubmit(); });
    }
    if (el.pause) {
      el.pause.addEventListener('click', function() { if (self.paused) self.resume(); else self.pause(); });
    }
    if (el.resume) {
      el.resume.addEventListener('click', function() { self.resume(); });
    }
    if (el.giveUp) {
      el.giveUp.addEventListener('click', function() { self.giveUp(); });
    }
    if (el.reset) {
      el.reset.addEventListener('click', function() { self.reset(); });
    }
    if (el.ghosts) {
      el.ghosts.addEventListener('change', function() { self.state.ghosts = el.ghosts.checked; self.save(); self.renderMap(); });
    }
    Array.prototype.forEach.call(el.modes, function(btn) {
      btn.addEventListener('click', function() { self.setMode(btn.getAttribute('data-mode')); el.input.focus(); });
    });
    Array.prototype.forEach.call(el.zoom, function(btn) {
      btn.addEventListener('click', function() {
        self.zoomAt(btn.getAttribute('data-zoom') === 'in' ? 1.6 : 1 / 1.6, el.map.clientWidth / 2, el.map.clientHeight / 2);
      });
    });
    this.bindMapEvents();
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden' && self.startedAt) {
        self.current().elapsed = self.elapsed();
        self.startedAt = Date.now();
        self.save();
      }
    });
  };

  Game.prototype.onInput = function() {
    var raw = this.el.input.value;
    if (!raw.trim()) return;
    this.startTimer();
    var key = normalise(raw);
    if (key.length < 3) return;
    var matches = this.lookup(raw, false);
    var cur = this.current();
    if (!matches || this.isPrefixOfAnother(key)) return;
    if (matches.every(function(i) { return cur.found.indexOf(i) !== -1; })) return;
    this.accept(matches);
  };

  Game.prototype.onSubmit = function() {
    var raw = this.el.input.value.trim();
    if (!raw) return;
    this.startTimer();
    var matches = this.lookup(raw, true);
    if (matches) {
      this.accept(matches);
    } else {
      this.el.message.textContent = 'No ' + MODE_TEXT[this.state.mode].noun + ' called "' + raw + '".';
      this.flash('is-bad');
    }
  };

  Game.prototype.bindMapEvents = function() {
    var self = this;
    var map = this.el.map;
    if (!map) return;
    map.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = map.getBoundingClientRect();
      self.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    map.addEventListener('pointerdown', function(e) {
      if (e.target.closest('button')) return;
      map.setPointerCapture(e.pointerId);
      self.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      map.classList.add('is-dragging');
    });
    map.addEventListener('pointermove', function(e) {
      var prev = self.pointers[e.pointerId];
      if (!prev) { self.showTooltip(e); return; }
      self.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(self.pointers);
      if (ids.length === 2) {
        var a = self.pointers[ids[0]];
        var b = self.pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var rect = map.getBoundingClientRect();
        if (self.pinch) self.zoomAt(d / self.pinch, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        self.pinch = d;
        return;
      }
      self.view.tx += e.clientX - prev.x;
      self.view.ty += e.clientY - prev.y;
      self.renderMap();
    });
    function release(e) {
      delete self.pointers[e.pointerId];
      if (Object.keys(self.pointers).length < 2) self.pinch = null;
      if (!Object.keys(self.pointers).length) map.classList.remove('is-dragging');
    }
    map.addEventListener('pointerup', release);
    map.addEventListener('pointercancel', release);
    map.addEventListener('pointerleave', function() { if (self.el.tooltip) self.el.tooltip.classList.remove('is-visible'); });
    if (window.ResizeObserver) {
      var lastWidth = map.clientWidth;
      new ResizeObserver(function() {
        if (map.clientWidth !== lastWidth) { lastWidth = map.clientWidth; self.fitAll(); }
      }).observe(map);
    }
  };

  // ---- boot ----

  function readInline(root, cls) {
    var node = root.querySelector('.' + cls);
    return node ? JSON.parse(node.textContent) : null;
  }

  function init(root) {
    var grounds = readInline(document, 'game-data-grounds');
    var outline = readInline(document, 'game-data-outline');
    if (grounds && outline) { new Game(root, grounds, outline); return; }
    Promise.all([
      fetch(root.getAttribute('data-grounds')).then(function(r) { return r.json(); }),
      fetch(root.getAttribute('data-outline')).then(function(r) { return r.json(); })
    ]).then(function(data) {
      new Game(root, data[0], data[1]);
    }).catch(function() {
      var msg = root.querySelector('.game-message');
      if (msg) msg.textContent = 'The map data did not load. Refresh the page to try again.';
    });
  }

  var games = document.querySelectorAll('.game');
  Array.prototype.forEach.call(games, init);
})();
