(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function init() {
    const root = document.getElementById('dependency-graph');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const svg = root.querySelector('#graph-svg'), summary = root.querySelector('#graph-summary');
    const inspector = root.querySelector('#graph-inspector'), search = root.querySelector('#graph-search');
    let graph, selected, box, drag, moved = false;
    function el(tag, attrs, text) {
      const e = document.createElementNS(NS, tag);
      Object.entries(attrs || {}).forEach(([key, value]) => e.setAttribute(key, value));
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function view() { svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`); }
    function fit() {
      if (!graph) return;
      box = {x: 0, y: 0, w: graph.width, h: graph.height}; view();
    }
    function zoom(factor, x = box.x + box.w / 2, y = box.y + box.h / 2) {
      if (box.w * factor < 150 || box.w * factor > graph.width * 8) return;
      box = {x: x + (box.x - x) * factor, y: y + (box.y - y) * factor, w: box.w * factor, h: box.h * factor}; view();
    }
    function point(event) {
      return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    }
    function state(n) {
      if (n.status === 'done') return 'done';
      if (n.status === 'blocked' || graph.edges.some(e => e.child_id === n.id && graph.nodes.find(t => t.id === e.parent_id).status !== 'done')) return 'blocked';
      return n.status;
    }
    function highlight() {
      const query = search.value.toLowerCase().trim();
      let matches = 0;
      svg.querySelectorAll('.graph-node').forEach(e => {
        const n = graph.nodes.find(n => n.id === e.dataset.id);
        const match = query && `${n.id} ${n.title}`.toLowerCase().includes(query);
        if (match) matches++;
        e.classList.toggle('graph-match', !!match);
        e.classList.toggle('graph-selected', n.id === selected);
      });
      svg.querySelectorAll('.graph-edge').forEach(e => {
        e.classList.toggle('graph-edge-selected', e.dataset.from === selected || e.dataset.to === selected);
      });
      summary.textContent = `${graph.nodes.length} issues · ${graph.groups.filter(g => g.id).length} epic groups · ${graph.edges.length} dependencies · all statuses included${query ? ` · ${matches} matches` : ''}`;
    }
    function inspect(id) {
      selected = id;
      const n = graph.nodes.find(n => n.id === id);
      inspector.replaceChildren();
      const title = document.createElement('strong'); title.textContent = n.title; inspector.append(title);
      const meta = document.createElement('p'); meta.textContent = `${n.id} · ${n.status.replace('_', ' ')} · P${n.priority}${state(n) === 'blocked' ? ' · blocked by unfinished work or explicitly marked blocked' : ''}`; inspector.append(meta);
      function links(label, ids) {
        const p = document.createElement('p'); p.append(`${label}: `);
        if (!ids.length) p.append('None');
        ids.forEach((id, i) => {
          if (i) p.append(', ');
          const link = document.createElement('a'); link.href = '/tasks/' + encodeURIComponent(id);
          link.textContent = graph.nodes.find(t => t.id === id).title; p.append(link);
        });
        inspector.append(p);
      }
      links('Blockers', graph.edges.filter(e => e.child_id === id).map(e => e.parent_id));
      links('Dependents', graph.edges.filter(e => e.parent_id === id).map(e => e.child_id));
      if (n.parent_id) links('Parent', graph.nodes.some(t => t.id === n.parent_id) ? [n.parent_id] : []);
      const link = document.createElement('a'); link.href = '/tasks/' + encodeURIComponent(id); link.textContent = 'Open issue →'; inspector.append(link);
      highlight();
    }
    function draw() {
      svg.replaceChildren();
      const defs = el('defs'), marker = el('marker', {id: 'graph-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'});
      marker.append(el('path', {d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke'})); defs.append(marker); svg.append(defs);
      graph.groups.forEach(g => {
        svg.append(el('rect', {x: 16, y: g.y, width: g.width - 32, height: g.height - 10, rx: 10, class: 'graph-lane'}));
        svg.append(el('text', {x: 32, y: g.y + 23, class: 'graph-lane-title'}, g.title));
      });
      const byId = new Map(graph.nodes.map(n => [n.id, n]));
      function edge(from, to, membership) {
        const a = byId.get(from), b = byId.get(to);
        if (!a || !b) return;
        let x1 = a.x + 240, y1 = a.y + 37, x2 = b.x - 3, y2 = b.y + 37;
        // Same-column membership curves around the left of cards.
        let d;
        if (membership && a.x === b.x) {
          x1 = a.x; x2 = b.x;
          d = `M${x1},${y1} C${x1 - 25},${y1} ${x2 - 25},${y2} ${x2},${y2}`;
        } else {
          const bend = Math.max(30, Math.abs(x2 - x1) * .45);
          d = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
        }
        const path = el('path', {d, class: membership ? 'graph-membership' : 'graph-edge', ...(membership ? {} : {'marker-end': 'url(#graph-arrow)'})});
        path.dataset.from = from; path.dataset.to = to;
        path.append(el('title', {}, `${a.title} ${membership ? 'contains' : 'blocks'} ${b.title}`)); svg.append(path);
      }
      graph.nodes.forEach(n => { if (n.parent_id) edge(n.parent_id, n.id, true); });
      graph.edges.forEach(e => edge(e.parent_id, e.child_id, false));
      graph.nodes.forEach(n => {
        const g = el('g', {class: `graph-node graph-status-${state(n)}`, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'aria-label': `${n.id}: ${n.title}; ${state(n).replace('_', ' ')}`});
        g.dataset.id = n.id;
        g.append(el('title', {}, `${n.id}: ${n.title}`));
        g.append(el('rect', {width: 240, height: 74, rx: 8}));
        g.append(el('circle', {cx: 15, cy: 18, r: 4}));
        g.append(el('text', {x: 26, y: 22, class: 'graph-meta'}, `${n.id} · P${n.priority} · ${n.status.replace('_', ' ')}`));
        // Split titles into two lines; the full text is available on hover and selection.
        const words = n.title.split(/\s+/), lines = [''];
        words.forEach(w => { if ((lines[lines.length - 1] + w).length > 29 && lines.length < 2) lines.push(''); lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + w; });
        lines.forEach((line, i) => g.append(el('text', {x: 12, y: 43 + i * 17, class: 'graph-title'}, line.length > 31 ? line.slice(0, 30) + '…' : line)));
        g.addEventListener('click', () => { if (!moved) inspect(n.id); });
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(n.id); } });
        g.addEventListener('focus', () => {
          if (box.w < graph.width && (n.x < box.x || n.x + 240 > box.x + box.w || n.y < box.y || n.y + 74 > box.y + box.h)) {
            box.x = n.x + 120 - box.w / 2; box.y = n.y + 37 - box.h / 2; view();
          }
        });
        svg.append(g);
      });
      highlight();
    }
    async function load() {
      const button = root.querySelector('#graph-refresh'); button.disabled = true;
      try {
        const response = await fetch('/api/graph');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const initial = !graph;
        graph = window.layoutTacksGraph(data.tasks, data.dependencies); draw();
        if (initial) fit();
        if (selected && graph.nodes.some(n => n.id === selected)) inspect(selected);
        if (!graph.nodes.length) summary.textContent = 'No issues yet. Create an issue to start your graph.';
      } catch (e) { summary.textContent = `Could not load graph: ${e.message}. Use Refresh to retry.`; }
      finally { button.disabled = false; }
    }
    root.querySelector('#graph-fit').onclick = fit;
    root.querySelector('#graph-in').onclick = () => { if (box) zoom(.8); };
    root.querySelector('#graph-out').onclick = () => { if (box) zoom(1.25); };
    root.querySelector('#graph-refresh').onclick = load;
    search.oninput = () => { if (graph) highlight(); };
    svg.addEventListener('wheel', e => { if (!box) return; e.preventDefault(); const p = point(e); zoom(e.deltaY > 0 ? 1.12 : .89, p.x, p.y); }, {passive: false});
    svg.addEventListener('pointerdown', e => { if (!box || e.button !== 0) return; moved = false; drag = {point: point(e), x: e.clientX, y: e.clientY, box: {...box}}; });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      moved = true; svg.setPointerCapture(e.pointerId);
      const p = point(e); box.x += drag.point.x - p.x; box.y += drag.point.y - p.y; view();
    });
    function endDrag(e) { drag = null; if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); }
    svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
    load();
  }
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('htmx:afterSettle', init);
  document.addEventListener('htmx:historyRestore', () => { const root = document.getElementById('dependency-graph'); if (root) { delete root.dataset.initialized; init(); } });
})();
