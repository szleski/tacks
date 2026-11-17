/* Dependency-only ranks keep every blocker to the left of its dependent.
 * Parent membership determines lanes, never dependency direction. */
(function (root) {
  'use strict';
  // Each epic owns a lane; nested epics get their own heading too. An epic is a task tagged `epic` or referenced as some
  // task's parent. Every other task joins the lane of its nearest epic ancestor, or the unnamed '' lane (independent issues).
  // Returns the epic ids, the lane of a task, and the lanes themselves (lane id -> member tasks, in input order).
  function laneIndex(nodes, byId) {
    const parentIds = new Set(nodes.map(n => n.parent_id).filter(Boolean));
    const headerIds = new Set(nodes.filter(n => n.tags.includes('epic') || parentIds.has(n.id)).map(n => n.id));
    function laneId(node) {
      if (headerIds.has(node.id)) return node.id;
      const seen = new Set([node.id]);
      while (node.parent_id && byId.has(node.parent_id) && !seen.has(node.parent_id)) {
        seen.add(node.parent_id); node = byId.get(node.parent_id);
        if (headerIds.has(node.id)) return node.id;
      }
      return '';
    }
    const lanes = new Map();
    nodes.forEach(n => { const key = laneId(n); if (!lanes.has(key)) lanes.set(key, []); lanes.get(key).push(n); });
    return {headerIds, laneId, lanes};
  }
  // Pure display filter: drops every epic lane whose heading and tickets are all done. Lanes are judged independently
  // (a nested epic has its own lane) and the '' lane is never an epic, so independent issues always stay. The input is
  // not mutated. Returns {tasks: remaining tasks in input order, hiddenEpicIds: sorted ids of the hidden epics,
  // hiddenIds: sorted ids of every hidden ticket (epics included)}. Run it before layoutGraph so ranks and rows compact;
  // dependencies touching hidden tickets need no pruning because layoutGraph ignores edges whose endpoints are absent.
  function hideCompletedEpics(tasks) {
    const {headerIds, lanes} = laneIndex(tasks, new Map(tasks.map(t => [t.id, t])));
    const done = t => t.status === 'done';
    const hiddenEpicIds = [...headerIds].filter(id => lanes.get(id).every(done)).sort((a, b) => a.localeCompare(b));
    const hidden = new Set(hiddenEpicIds.flatMap(id => lanes.get(id).map(t => t.id)));
    const kept = tasks.filter(t => !hidden.has(t.id));
    // An epic that is only a heading because a hidden nested epic points at it must stay a heading, not turn into a card.
    const {headerIds: remaining} = laneIndex(kept, new Map(kept.map(t => [t.id, t])));
    return {
      tasks: kept.map(t => headerIds.has(t.id) && !remaining.has(t.id) ? {...t, tags: [...t.tags, 'epic']} : t),
      hiddenEpicIds,
      hiddenIds: [...hidden].sort((a, b) => a.localeCompare(b)),
    };
  }
  function layoutGraph(tasks, dependencies) {
    const nodes = tasks.map(task => ({...task, rank: 0})).sort((a, b) => a.id.localeCompare(b.id));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const edges = dependencies.filter(e => byId.has(e.parent_id) && byId.has(e.child_id));
    const outgoing = new Map(nodes.map(n => [n.id, []]));
    const degree = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach(e => { outgoing.get(e.parent_id).push(e.child_id); degree.set(e.child_id, degree.get(e.child_id) + 1); });
    const queue = nodes.filter(n => degree.get(n.id) === 0);
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      outgoing.get(node.id).forEach(id => {
        const child = byId.get(id);
        child.rank = Math.max(child.rank, node.rank + 1);
        degree.set(id, degree.get(id) - 1);
        if (!degree.get(id)) queue.push(child);
      });
    }
    const {lanes} = laneIndex(nodes, byId);
    let y = 36;
    const groups = [];
    const width = Math.max(740, (Math.max(0, ...nodes.map(n => n.rank)) + 1) * 300 + 80);
    [...lanes.keys()].sort().forEach(key => {
      const members = lanes.get(key), start = y;
      const header = key ? byId.get(key) : null;
      if (header) {
        header.isLaneHeader = true;
        header.x = 40 + header.rank * 300; header.y = start + 8;
        header.width = width - header.x - 40; header.height = 24; header.lane = key;
      }
      y += 44;
      const counts = new Map();
      members.filter(n => n !== header).forEach(n => {
        const row = counts.get(n.rank) || 0;
        n.x = 40 + n.rank * 300; n.y = y + row * 100;
        n.width = 240; n.height = 74; n.isLaneHeader = false;
        counts.set(n.rank, row + 1);
        n.lane = key;
      });
      y += Math.max(0, ...counts.values()) * 100 + 20;
      groups.push({id: key, title: header ? header.title : 'Independent issues', y: start, height: y - start, width});
    });
    return {nodes, edges, groups, width, height: Math.max(240, y + 20)};
  }
  root.layoutTacksGraph = layoutGraph;
  root.hideCompletedEpics = hideCompletedEpics;
  // The default export stays the layout function; the filter hangs off it as a property.
  if (typeof module !== 'undefined') module.exports = Object.assign(layoutGraph, {hideCompletedEpics});
})(typeof window === 'undefined' ? globalThis : window);
