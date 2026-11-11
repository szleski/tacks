const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../static/graph-layout.js');
const node = (id, parent_id = null, tags = []) => ({id, parent_id, tags, title: id, status: 'open'});
const edge = (parent_id, child_id) => ({parent_id, child_id});

test('every issue survives layout, including completed, isolated, epic, nested and leaf nodes', () => {
  const tasks = [node('epic', null, ['epic']), node('a', 'epic'), node('b', 'a'), node('solo'), {...node('done'), status: 'done'}];
  const graph = layout(tasks, [edge('done', 'a'), edge('a', 'b')]);
  assert.equal(graph.nodes.length, tasks.length);
  assert.equal(graph.nodes.find(n => n.id === 'b').lane, 'a');
  assert.ok(graph.nodes.find(n => n.id === 'epic').isLaneHeader);
  assert.ok(graph.nodes.find(n => n.id === 'a').isLaneHeader);
  for (const n of graph.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width < graph.width && n.y + n.height < graph.height);
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

test('five epics become headings and only their 25 member issues consume card rows', () => {
  const tasks = Array.from({length: 5}, (_, i) => [node(`e${i}`, null, ['epic']), ...Array.from({length: 5}, (_, j) => node(`e${i}.${j}`, `e${i}`))]).flat();
  const graph = layout(tasks, []);
  assert.equal(graph.nodes.length, 30);
  assert.equal(graph.nodes.filter(n => n.isLaneHeader).length, 5);
  assert.equal(graph.nodes.filter(n => !n.isLaneHeader).length, 25);
  for (const group of graph.groups) {
    const heading = graph.nodes.find(n => n.id === group.id);
    assert.ok(heading.y >= group.y && heading.y + heading.height < group.y + 44);
    const cards = graph.nodes.filter(n => n.lane === group.id && !n.isLaneHeader);
    assert.equal(cards.length, 5);
    assert.equal(Math.min(...cards.map(n => n.y)), group.y + 44);
  }
});

test('empty epic and actual dependencies on epics stay represented as headings', () => {
  const tasks = [node('empty', null, ['epic']), node('epic', null, ['epic']), node('before'), node('after', 'epic')];
  const edges = [edge('before', 'epic'), edge('epic', 'after')];
  const graph = layout(tasks, edges);
  assert.deepEqual(graph.edges, edges);
  assert.ok(graph.nodes.find(n => n.id === 'empty').isLaneHeader);
  assert.ok(graph.nodes.find(n => n.id === 'epic').isLaneHeader);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const e of edges) assert.ok(byId.get(e.parent_id).x < byId.get(e.child_id).x);
  for (const n of graph.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
});
