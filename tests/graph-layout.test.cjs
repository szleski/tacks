const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../static/graph-layout.js');
const node = (id, parent_id = null, tags = []) => ({id, parent_id, tags, title: id, status: 'open'});
const edge = (parent_id, child_id) => ({parent_id, child_id});

test('every issue survives layout, including completed, isolated, epic, nested and leaf nodes', () => {
  const tasks = [node('epic', null, ['epic']), node('a', 'epic'), node('b', 'a'), node('solo'), {...node('done'), status: 'done'}];
  const graph = layout(tasks, [edge('done', 'a'), edge('a', 'b')]);
  assert.equal(graph.nodes.length, tasks.length);
  assert.equal(graph.nodes.find(n => n.id === 'b').lane, 'epic');
  for (const n of graph.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + 240 < graph.width && n.y + 74 < graph.height);
  }
  assert.equal(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size, tasks.length);
  assert.deepEqual(tasks.map(n => n.rank), tasks.map(() => undefined), 'input is not mutated');
});

test('diamonds and cross-epic chains always point forward, independent of input order', () => {
  const tasks = [node('E1', null, ['epic']), node('E2', null, ['epic']), node('d', 'E2'), node('b', 'E1'), node('c', 'E2'), node('a', 'E1')];
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  const graph = layout(tasks, edges);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const e of graph.edges) assert.ok(byId.get(e.parent_id).x < byId.get(e.child_id).x);
  assert.equal(byId.get('d').rank, 2);
  assert.equal(graph.groups.length, 2);
  assert.deepEqual(layout([...tasks].reverse(), edges), graph);
});

test('empty graph is usable and malformed edges do not crash layout', () => {
  assert.equal(layout([], []).nodes.length, 0);
  assert.equal(layout([node('a')], [edge('missing', 'a')]).edges.length, 0);
});
