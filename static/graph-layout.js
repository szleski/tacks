/* Dependency-only ranks keep every blocker to the left of its dependent.
 * Parent membership determines lanes, never dependency direction. */
(function (root) {
  'use strict';
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
    // Nested subtasks belong to the lane of their outermost parent.
    function laneId(node) {
      const seen = new Set([node.id]);
      while (node.parent_id && byId.has(node.parent_id) && !seen.has(node.parent_id)) {
        seen.add(node.parent_id); node = byId.get(node.parent_id);
      }
      return node.tags.includes('epic') || tasks.some(t => t.parent_id === node.id) ? node.id : '';
    }
    const lanes = new Map();
    nodes.forEach(n => { const key = laneId(n); if (!lanes.has(key)) lanes.set(key, []); lanes.get(key).push(n); });
    let y = 36;
    const groups = [];
    const width = Math.max(740, (Math.max(0, ...nodes.map(n => n.rank)) + 1) * 300 + 80);
    [...lanes.keys()].sort().forEach(key => {
      const members = lanes.get(key), start = y;
      y += 36;
      const counts = new Map();
      members.forEach(n => {
        const row = counts.get(n.rank) || 0;
        n.x = 40 + n.rank * 300; n.y = y + row * 100;
        counts.set(n.rank, row + 1);
        n.lane = key;
      });
      y += Math.max(...counts.values()) * 100 + 20;
      groups.push({id: key, title: key ? byId.get(key).title : 'Independent issues', y: start, height: y - start, width});
    });
    return {nodes, edges, groups, width, height: Math.max(240, y + 20)};
  }
  root.layoutTacksGraph = layoutGraph;
  if (typeof module !== 'undefined') module.exports = layoutGraph;
})(typeof window === 'undefined' ? globalThis : window);
