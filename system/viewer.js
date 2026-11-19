(function () {
  'use strict';

  /* ============================ 常量 ============================ */
  const TYPE_LABELS = {
    file: '文件', class: '类', function: '函数', service: '服务', document: '文档', config: '配置',
    domain: '业务域', flow: '流程', step: '步骤',
  };
  const TYPE_COLORS = {
    file: '#4a7c9b', function: '#5a9e6f', class: '#8b6fb0', config: '#5eead4',
    document: '#7dd3fc', service: '#a78bfa', domain: '#d4a574', flow: '#5a9e6f', step: '#4a7c9b',
  };
  const EDGE_LABELS = {
    imports: '引用', contains: '包含', exports: '导出', calls: '调用', inherits: '继承',
    depends_on: '依赖', deploys: '部署', related: '关联', documents: '文档说明',
    configures: '配置', tested_by: '测试', routes: '路由', contains_flow: '包含流程',
    flow_step: '流程步骤', cross_domain: '跨域依赖',
  };
  const COMPLEXITY_LABELS = { simple: '简单', moderate: '中等', complex: '复杂' };

  const CARD_W = 236;
  const CARD_H = 52;
  const NODE_GAP_Y = 14;
  const COL_GAP = 96;
  const PAD = 64;

  /* ============================ 工具 ============================ */
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function typeLabel(type) { return TYPE_LABELS[type] || type; }
  function edgeLabel(type) { return EDGE_LABELS[type] || type; }
  function complexityLabel(c) { return COMPLEXITY_LABELS[c] || c; }
  function typeColor(type) { return TYPE_COLORS[type] || '#d4a574'; }

  function formatDate(value) {
    if (!value) return '未知';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = String(p).split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : p;
  }

  /* ============================ DOM ============================ */
  const dom = {
    title: $('project-title'),
    tabs: $('tabs'),
    searchInput: $('search-input'),
    searchResults: $('search-results'),
    nodeTypeFilters: $('node-type-filters'),
    edgeTypeFilters: $('edge-type-filters'),
    filterBar: $('filter-bar'),
    nodeTypesAll: $('node-types-all'),
    edgeTypesAll: $('edge-types-all'),
    edgeFiltersSection: $('edge-filters-section'),
    layersSection: $('layers-section'),
    layerFilters: $('layer-filters'),
    layersAll: $('layers-all'),
    canvasWrap: $('canvas-wrap'),
    world: $('canvas-world'),
    edgeLayer: $('edge-layer'),
    nodeLayer: $('node-layer'),
    overview: $('overview'),
    details: $('details'),
    hint: $('canvas-hint'),
    loading: $('loading'),
    tourBar: $('tour-bar'),
    tourToggle: $('tour-toggle'),
    zoomIn: $('zoom-in'),
    zoomOut: $('zoom-out'),
    zoomFit: $('zoom-fit'),
    toggleLeft: $('toggle-left'),
    toggleRight: $('toggle-right'),
  };

  /* ============================ 状态 ============================ */
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const projectId = params.get('project');

  const state = {
    projectId,
    data: null,
    tab: 'overview',
    graph: null,
    nodeMap: new Map(),
    positions: new Map(),
    nodeEls: new Map(),
    nodeTypes: [],
    edgeTypes: [],
    layerList: [],
    layerBoxes: [],
    hiddenNodeTypes: new Set(),
    hiddenEdgeTypes: new Set(),
    hiddenLayers: new Set(),
    selectedId: null,
    tourActive: false,
    tourIndex: 0,
    view: { x: 0, y: 0, k: 1 },
    world: { w: 0, h: 0 },
  };

  /* ============================ 加载 ============================ */
  function fatal(message) {
    if (dom.loading) {
      dom.loading.className = 'fatal';
      dom.loading.innerHTML = message;
    }
    if (dom.hint) dom.hint.style.display = 'none';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('无法加载 ' + src));
      document.head.appendChild(s);
    });
  }

  async function boot() {
    if (!projectId) {
      fatal('URL 缺少 <code>#project=&lt;项目&gt;</code> 参数。<br>请从<a href="index.html">项目列表</a>进入。');
      return;
    }
    try {
      await loadScript('system/data/' + encodeURIComponent(projectId) + '.js');
    } catch (err) {
      fatal('项目数据文件不存在或无法读取：<code>' + esc(projectId) + '.js</code><br>' +
        '请运行 <code>python bliud.py</code> 重新构建后再打开。');
      return;
    }

    const data = (window.UA_DATA || {})[projectId];
    if (!data) {
      fatal('未找到项目 <code>' + esc(projectId) + '</code> 的数据，请重新构建。');
      return;
    }

    state.data = data;
    const project = (data.knowledge && data.knowledge.project) ||
      (data.domain && data.domain.project) || {};
    const displayName = project.name || projectId;
    document.title = displayName + ' · AI 车间';
    dom.title.textContent = displayName;

    Array.from(dom.tabs.querySelectorAll('.tab')).forEach((btn) => {
      const kind = btn.dataset.tab;
      btn.disabled = kind !== 'overview' && !data[kind];
      btn.addEventListener('click', () => switchTab(kind));
    });

    dom.loading.remove();
    dom.searchInput.disabled = false;

    const initial = 'overview';
    switchTab(initial);
  }

  /* ============================ 标签页 ============================ */
  function switchTab(tab) {
    state.tab = tab;
    state.selectedId = null;
    state.hiddenNodeTypes = new Set();
    state.hiddenEdgeTypes = new Set();
    state.hiddenLayers = new Set();
    dom.searchInput.value = '';
    dom.searchResults.textContent = '';

    Array.from(dom.tabs.querySelectorAll('.tab')).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const isGraph = tab === 'knowledge' || tab === 'domain';
    dom.overview.classList.toggle('active', tab === 'overview');
    dom.world.style.display = isGraph ? '' : 'none';
    dom.hint.style.display = isGraph ? '' : 'none';
    dom.tourBar.classList.add('hidden');

    if (dom.filterBar) {
      dom.filterBar.hidden = !isGraph;
    } else {
      dom.nodeTypeFilters.parentElement.style.display = isGraph ? '' : 'none';
      dom.edgeFiltersSection.style.display = isGraph ? '' : 'none';
    }
    document.body.classList.toggle('hide-left', tab !== 'knowledge');
    dom.layersSection.style.display = tab === 'knowledge' ? '' : 'none';
    dom.searchInput.disabled = tab === 'overview';
    dom.tourToggle.disabled = tab !== 'knowledge';
    dom.tourToggle.classList.toggle('active', tab === 'knowledge' && state.tourActive);

    dom.nodeLayer.textContent = '';
    dom.nodeLayer.removeAttribute('style');
    dom.edgeLayer.textContent = '';
    dom.edgeLayer.removeAttribute('width');
    dom.edgeLayer.removeAttribute('height');
    state.positions = new Map();
    state.nodeEls = new Map();
    state.layerList = [];
    state.layerBoxes = [];

    // 概览默认收起左右侧栏，进入图谱标签时恢复
    setSidebarCollapsed('left', tab === 'overview');
    setSidebarCollapsed('right', tab === 'overview');

    if (tab === 'knowledge') renderKnowledge();
    else if (tab === 'domain') renderDomain();
    else renderOverview();

    if (tab === 'knowledge' && state.tourActive) renderTourStep();
    else if (tab !== 'knowledge') state.tourActive = false;

    if (!isGraph) {
      dom.details.innerHTML = '<div class="detail-empty">概览页不显示节点详情。切换到图谱标签后点击节点查看。</div>';
    }
  }

  /* ============================ 索引 ============================ */
  function indexGraph(graph) {
    state.graph = graph;
    state.nodeMap = new Map();
    (graph.nodes || []).forEach((n) => state.nodeMap.set(n.id, n));
  }

  function nodeName(id) {
    const n = state.nodeMap.get(id);
    return n ? n.name : id;
  }

  /* ============================ 知识图谱布局 ============================ */
  const MAX_PER_COLUMN = 32;

  function layoutKnowledge(graph) {
    const layers = Array.isArray(graph.layers) ? graph.layers : [];
    const layerIndexOf = new Map();
    layers.forEach((layer, i) => (layer.nodeIds || []).forEach((id) => layerIndexOf.set(id, i)));

    const inLayer = new Set(layerIndexOf.keys());
    (graph.edges || []).forEach((edge) => {
      if (edge.type !== 'contains') return;
      const li = layerIndexOf.get(edge.source);
      if (li == null || layerIndexOf.has(edge.target)) return;
      if (!state.nodeMap.has(edge.target)) return;
      layerIndexOf.set(edge.target, li);
    });

    const groups = layers.map((layer) => ({
      id: layer.id, name: layer.name, description: layer.description || '', nodes: [],
    }));
    const extra = { id: 'layer:_extra', name: '未分层', description: '没有被任何图层收录的节点。', nodes: [] };

    groups.forEach((group, i) => {
      (layers[i].nodeIds || []).forEach((id) => {
        const node = state.nodeMap.get(id);
        if (node) group.nodes.push(node);
      });
    });

    (graph.nodes || []).forEach((node) => {
      if (inLayer.has(node.id)) return;
      const li = layerIndexOf.get(node.id);
      if (li != null) groups[li].nodes.push(node);
      else extra.nodes.push(node);
    });

    if (extra.nodes.length) groups.push(extra);

    // 节点过多时把同一图层拆成多个子列，避免单列过长
    const columns = [];
    groups.forEach((group) => {
      const chunks = [];
      for (let i = 0; i < group.nodes.length; i += MAX_PER_COLUMN) {
        chunks.push(group.nodes.slice(i, i + MAX_PER_COLUMN));
      }
      if (!chunks.length) chunks.push([]);
      chunks.forEach((nodes, ci) => {
        columns.push({ layerId: group.id, name: group.name, nodes, first: ci === 0 });
      });
    });

    const colHeight = (n) => (n ? n * CARD_H + (n - 1) * NODE_GAP_Y : 0);
    const maxHeight = Math.max(1, ...columns.map((c) => colHeight(c.nodes.length)));
    const width = PAD * 2 + columns.length * CARD_W + Math.max(0, columns.length - 1) * COL_GAP;
    const height = PAD * 2 + maxHeight;

    const positions = new Map();
    const headers = [];
    const layerBoxes = [];
    const layerList = groups.map((group) => ({
      id: group.id, name: group.name, description: group.description, count: group.nodes.length,
    }));

    columns.forEach((col, i) => {
      const x = PAD + i * (CARD_W + COL_GAP);
      const h = colHeight(col.nodes.length);
      const startY = PAD + (maxHeight - h) / 2;
      col.nodes.forEach((node, j) => {
        const y = startY + j * (CARD_H + NODE_GAP_Y);
        positions.set(node.id, { x, y, w: CARD_W, h: CARD_H, col: i, layer: col.layerId });
      });
      if (col.first) {
        const info = layerList.find((item) => item.id === col.layerId);
        headers.push({ x, y: PAD, w: CARD_W, h: maxHeight, layer: col.layerId, name: col.name, count: info ? info.count : col.nodes.length });
        layerBoxes.push({ id: col.layerId, x, y: PAD, w: CARD_W, h: maxHeight });
      } else {
        const box = layerBoxes[layerBoxes.length - 1];
        if (box) box.w = x + CARD_W - box.x;
      }
    });

    return { positions, headers, layerBoxes, layerList, width, height };
  }

  function renderKnowledge() {
    const graph = state.data.knowledge;
    if (!graph) return;
    indexGraph(graph);

    const layout = layoutKnowledge(graph);
    state.positions = layout.positions;
    state.world = { w: layout.width, h: layout.height };
    state.layerList = layout.layerList;
    state.layerBoxes = layout.layerBoxes;
    // 默认只显示第一个非空图层，避免一次性渲染全部节点导致浏览器卡顿
    const firstLayer = layout.layerList.find((layer) => layer.count > 0) || layout.layerList[0];
    state.hiddenLayers = new Set(
      layout.layerList
        .filter((layer) => !firstLayer || layer.id !== firstLayer.id)
        .map((layer) => layer.id)
    );
    state.nodeEls = new Map();

    dom.world.style.width = layout.width + 'px';
    dom.world.style.height = layout.height + 'px';

    layout.headers.forEach((box) => {
      const header = el('div', 'column-head');
      header.dataset.layer = box.layer;
      header.style.cssText = 'position:absolute;left:' + box.x + 'px;top:' + (box.y - 44) + 'px;width:' + box.w + 'px;';
      header.appendChild(el('div', 'ch-name', box.name));
      header.appendChild(el('div', 'ch-count', box.count + ' 个节点'));
      dom.nodeLayer.appendChild(header);
    });

    const fragment = document.createDocumentFragment();
    layout.positions.forEach((pos, id) => {
      const node = state.nodeMap.get(id);
      if (!node) return;
      const card = makeNodeCard(node, pos, pos.layer);
      state.nodeEls.set(id, card);
      fragment.appendChild(card);
    });
    dom.nodeLayer.appendChild(fragment);

    drawKnowledgeEdges();
    buildFilterPanels();
    applyFilters();
    resetView();
    dom.details.innerHTML = '<div class="detail-empty">在左侧画布中选择一个节点，这里会显示它的说明、标签与关联关系。</div>';
    updateTourToggle();
  }

  function makeNodeCard(node, pos, layerId) {
    const card = el('div', 'node-card');
    card.dataset.node = node.id;
    card.dataset.type = node.type;
    card.dataset.layer = layerId || '';
    card.style.left = pos.x + 'px';
    card.style.top = pos.y + 'px';
    card.style.setProperty('--c', typeColor(node.type));

    if (node.complexity) {
      const dot = el('span', 'nc-cx cx-' + node.complexity);
      dot.title = '复杂度：' + complexityLabel(node.complexity);
      card.appendChild(dot);
    }
    const top = el('div', 'nc-top');
    top.appendChild(el('span', 'nc-name', node.name));
    top.appendChild(el('span', 'nc-type', typeLabel(node.type)));
    card.appendChild(top);
    card.appendChild(el('div', 'nc-sub',
      node.filePath ? shortPath(node.filePath) : (node.tags || []).slice(0, 2).join(' · ')));
    card.title = node.summary || node.name;
    return card;
  }

  /* ============================ 领域图谱布局 ============================ */
  function renderDomain() {
    const graph = state.data.domain;
    if (!graph) return;
    indexGraph(graph);

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const domains = nodes.filter((n) => n.type === 'domain');
    const flows = nodes.filter((n) => n.type === 'flow');
    const flowMap = new Map(flows.map((f) => [f.id, f]));

    const stepsByFlow = new Map();
    edges.filter((e) => e.type === 'flow_step').forEach((e) => {
      if (!stepsByFlow.has(e.source)) stepsByFlow.set(e.source, []);
      stepsByFlow.get(e.source).push(e.target);
    });

    const flowsByDomain = new Map();
    edges.filter((e) => e.type === 'contains_flow').forEach((e) => {
      if (!flowsByDomain.has(e.source)) flowsByDomain.set(e.source, []);
      flowsByDomain.get(e.source).push(e.target);
    });

    dom.nodeLayer.style.cssText = 'position:relative;width:1440px;padding:52px 48px 64px;box-sizing:border-box;';

    const placedFlows = new Set();
    const sections = [];

    domains.forEach((domain) => {
      const section = el('section', 'domain-section');
      section.dataset.section = domain.id;
      section.appendChild(domainHeader(domain, (flowsByDomain.get(domain.id) || []).length));
      const grid = el('div', 'flow-grid');
      (flowsByDomain.get(domain.id) || []).forEach((flowId) => {
        const flow = flowMap.get(flowId);
        if (!flow) return;
        placedFlows.add(flowId);
        grid.appendChild(flowCard(flow, stepsByFlow.get(flowId) || []));
      });
      if (!grid.children.length) grid.appendChild(el('div', 'no-flow', '该业务域下暂无流程。'));
      section.appendChild(grid);
      dom.nodeLayer.appendChild(section);
      sections.push(section);
    });

    const orphans = flows.filter((f) => !placedFlows.has(f.id));
    if (orphans.length) {
      const section = el('section', 'domain-section');
      section.dataset.section = 'section:orphan';
      const head = el('div', 'ds-head');
      const titleWrap = el('div');
      titleWrap.appendChild(el('div', 'ds-title', '未归属业务流程'));
      titleWrap.appendChild(el('div', 'ds-sum', '这些流程没有通过 contains_flow 关联到任何业务域。'));
      head.appendChild(titleWrap);
      section.appendChild(head);
      const grid = el('div', 'flow-grid');
      orphans.forEach((flow) => grid.appendChild(flowCard(flow, stepsByFlow.get(flow.id) || [])));
      section.appendChild(grid);
      dom.nodeLayer.appendChild(section);
      sections.push(section);
    }

    if (!domains.length && !orphans.length) {
      dom.nodeLayer.appendChild(el('div', 'no-flow', '该项目的领域图谱没有可展示的节点。'));
    }

    const width = dom.nodeLayer.offsetWidth || 1440;
    const height = dom.nodeLayer.offsetHeight || 800;
    state.world = { w: width, h: height };
    dom.world.style.width = width + 'px';
    dom.world.style.height = height + 'px';

    state.nodeEls = new Map();
    Array.from(dom.nodeLayer.querySelectorAll('[data-node]')).forEach((nodeEl) => {
      state.nodeEls.set(nodeEl.dataset.node, nodeEl);
    });

    drawDomainEdges(sections, edges);
    buildFilterPanels();
    applyFilters();
    state.view = { k: 0.82, x: 24, y: 16 };
    applyView();
    dom.details.innerHTML = '<div class="detail-empty">选择业务域、流程或步骤，查看它的业务规则与跨域依赖。</div>';
    updateTourToggle();
  }

  function domainHeader(domain, flowCount) {
    const head = el('div', 'ds-head');
    const wrap = el('div');
    const title = el('div', 'ds-title', domain.name);
    title.dataset.node = domain.id;
    title.dataset.type = 'domain';
    wrap.appendChild(title);
    if (domain.summary) wrap.appendChild(el('div', 'ds-sum', domain.summary));
    head.appendChild(wrap);
    head.appendChild(el('span', 'ds-badge', (flowCount || 0) + ' 条流程'));
    return head;
  }

  function flowCard(flow, stepIds) {
    const card = el('div', 'flow-card');
    card.dataset.type = 'flow';
    const head = el('div', 'flow-head');
    head.dataset.node = flow.id;
    head.dataset.type = 'flow';
    const wrap = el('div');
    wrap.style.cssText = 'flex:1;min-width:0;';
    wrap.appendChild(el('div', 'fh-name', flow.name));
    const entry = flow.domainMeta && flow.domainMeta.entryPoint;
    if (entry) wrap.appendChild(el('div', 'fh-entry', entry));
    head.appendChild(wrap);
    card.appendChild(head);

    const list = el('div', 'step-list');
    let index = 0;
    stepIds.forEach((stepId) => {
      const step = state.nodeMap.get(stepId);
      if (!step) return;
      index += 1;
      const item = el('div', 'step-item');
      item.dataset.node = step.id;
      item.dataset.type = 'step';
      item.appendChild(el('span', 'si-idx', String(index)));
      item.appendChild(el('span', 'si-name', step.name));
      item.title = step.summary || step.name;
      list.appendChild(item);
    });
    if (!index) list.appendChild(el('div', 'no-flow', '暂无步骤定义。'));
    card.appendChild(list);
    return card;
  }

  function drawDomainEdges(sections, edges) {
    const svg = dom.edgeLayer;
    svg.setAttribute('width', state.world.w);
    svg.setAttribute('height', state.world.h);
    svg.innerHTML = '';

    const boxes = new Map();
    sections.forEach((section) => {
      const title = section.querySelector('.ds-title');
      if (!title) return;
      boxes.set(section.dataset.section, {
        x: title.offsetLeft + dom.nodeLayer.offsetLeft,
        y: title.offsetTop + dom.nodeLayer.offsetTop + title.offsetHeight / 2,
      });
    });

    const railX = 20;
    edges.filter((e) => e.type === 'cross_domain').forEach((edge) => {
      const a = boxes.get(edge.source);
      const b = boxes.get(edge.target);
      if (!a || !b) return;
      const midY = (a.y + b.y) / 2;
      const d = 'M ' + a.x + ' ' + a.y +
        ' C ' + (railX + 60) + ' ' + a.y + ', ' + railX + ' ' + a.y + ', ' + railX + ' ' + midY +
        ' C ' + railX + ' ' + b.y + ', ' + (railX + 60) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'edge');
      path.setAttribute('d', d);
      path.dataset.type = edge.type;
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = nodeName(edge.source) + ' → ' + nodeName(edge.target);
      path.appendChild(title);
      svg.appendChild(path);
    });
  }

  /* ============================ 知识图谱连线 ============================ */
  function drawKnowledgeEdges() {
    const graph = state.graph;
    if (!graph) return;
    const svg = dom.edgeLayer;
    svg.setAttribute('width', state.world.w);
    svg.setAttribute('height', state.world.h);
    svg.innerHTML = '';

    (graph.edges || []).forEach((edge) => {
      const a = state.positions.get(edge.source);
      const b = state.positions.get(edge.target);
      if (!a || !b) return;

      const ay = a.y + a.h / 2;
      const by = b.y + b.h / 2;
      let d;
      if (a.x === b.x) {
        const x = a.x + a.w;
        d = 'M ' + x + ' ' + ay + ' C ' + (x + 46) + ' ' + ay + ', ' + (x + 46) + ' ' + by + ', ' + x + ' ' + by;
      } else if (a.x < b.x) {
        const sx = a.x + a.w;
        const dx = b.x - sx;
        d = 'M ' + sx + ' ' + ay +
          ' C ' + (sx + dx * 0.45) + ' ' + ay + ', ' + (b.x - dx * 0.45) + ' ' + by + ', ' + b.x + ' ' + by;
      } else {
        const sx = a.x;
        const dx = sx - (b.x + b.w);
        d = 'M ' + sx + ' ' + ay +
          ' C ' + (sx - dx * 0.45) + ' ' + ay + ', ' + (b.x + b.w + dx * 0.45) + ' ' + by + ', ' + (b.x + b.w) + ' ' + by;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'edge');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', (0.9 + (Number(edge.weight) || 0.5) * 0.9).toFixed(2));
      path.dataset.type = edge.type;
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = nodeName(edge.source) + ' —' + edgeLabel(edge.type) + '→ ' + nodeName(edge.target);
      path.appendChild(title);
      svg.appendChild(path);
    });
  }

  /* ============================ 过滤面板 ============================ */
  function countBy(list, key) {
    const map = new Map();
    (list || []).forEach((item) => {
      const k = item[key];
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }

  function buildFilterPanels() {
    const graph = state.graph;
    dom.nodeTypeFilters.textContent = '';
    dom.edgeTypeFilters.textContent = '';
    dom.layerFilters.textContent = '';

    const nodeCounts = countBy(graph.nodes, 'type');
    state.nodeTypes = Array.from(nodeCounts.keys());
    Array.from(nodeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        dom.nodeTypeFilters.appendChild(filterRow({
          label: typeLabel(type),
          count,
          color: typeColor(type),
          onChange: (checked) => {
            if (checked) state.hiddenNodeTypes.delete(type);
            else state.hiddenNodeTypes.add(type);
            updateFilterAllButtons();
            applyFilters();
          },
        }));
      });

    const edgeCounts = countBy(graph.edges, 'type');
    state.edgeTypes = Array.from(edgeCounts.keys());
    Array.from(edgeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        dom.edgeTypeFilters.appendChild(filterRow({
          label: edgeLabel(type),
          count,
          color: '#8a7a68',
          onChange: (checked) => {
            if (checked) state.hiddenEdgeTypes.delete(type);
            else state.hiddenEdgeTypes.add(type);
            updateFilterAllButtons();
            applyFilters();
          },
        }));
      });

    if (state.tab !== 'knowledge') {
      updateFilterAllButtons();
      return;
    }

    (state.layerList || []).forEach((layer) => {
      const row = el('label', 'layer-item');
      row.dataset.layer = layer.id;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !state.hiddenLayers.has(layer.id);
      cb.addEventListener('change', () => {
        if (cb.checked) state.hiddenLayers.delete(layer.id);
        else state.hiddenLayers.add(layer.id);
        updateFilterAllButtons();
        applyFilters();
      });
      const info = el('div');
      info.appendChild(el('div', 'li-name', layer.name));
      info.appendChild(el('div', 'li-count', layer.count + ' 个节点'));
      if (layer.description) info.appendChild(el('div', 'li-desc', layer.description));
      info.addEventListener('click', (e) => {
        if (e.target === cb) return;
        focusLayer(layer.id);
      });
      row.appendChild(cb);
      row.appendChild(info);
      dom.layerFilters.appendChild(row);
    });
    updateFilterAllButtons();
  }

  function setToggleLabel(btn, allChecked, total) {
    if (!btn) return;
    btn.textContent = allChecked ? '全不选' : '全选';
    btn.disabled = total === 0;
  }

  function updateFilterAllButtons() {
    setToggleLabel(dom.nodeTypesAll, state.hiddenNodeTypes.size === 0, state.nodeTypes.length);
    setToggleLabel(dom.edgeTypesAll, state.hiddenEdgeTypes.size === 0, state.edgeTypes.length);
    setToggleLabel(dom.layersAll, state.hiddenLayers.size === 0, state.layerList.length);
  }

  function setCheckboxes(container, checked) {
    if (!container) return;
    Array.from(container.querySelectorAll('input[type="checkbox"]')).forEach((cb) => {
      cb.checked = checked;
    });
  }

  function toggleAll(kind) {
    if (kind === 'node') {
      const showAll = state.hiddenNodeTypes.size > 0;
      state.hiddenNodeTypes = showAll ? new Set() : new Set(state.nodeTypes);
      setCheckboxes(dom.nodeTypeFilters, showAll);
    } else if (kind === 'edge') {
      const showAll = state.hiddenEdgeTypes.size > 0;
      state.hiddenEdgeTypes = showAll ? new Set() : new Set(state.edgeTypes);
      setCheckboxes(dom.edgeTypeFilters, showAll);
    } else if (kind === 'layer') {
      const showAll = state.hiddenLayers.size > 0;
      state.hiddenLayers = showAll ? new Set() : new Set(state.layerList.map((layer) => layer.id));
      setCheckboxes(dom.layerFilters, showAll);
    }
    updateFilterAllButtons();
    applyFilters();
  }

  function filterRow(opts) {
    const row = el('label', 'filter-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', opts.color);
    row.appendChild(cb);
    row.appendChild(dot);
    row.appendChild(el('span', null, opts.label));
    row.appendChild(el('span', 'count', String(opts.count)));
    cb.addEventListener('change', () => opts.onChange(cb.checked));
    return row;
  }

  /* ============================ 过滤 / 高亮 ============================ */
  function applyFilters() {
    const selected = state.selectedId;
    let neighborIds = null;
    if (selected && state.graph) {
      neighborIds = new Set([selected]);
      (state.graph.edges || []).forEach((e) => {
        if (e.source === selected) neighborIds.add(e.target);
        if (e.target === selected) neighborIds.add(e.source);
      });
    }

    Array.from(dom.nodeLayer.querySelectorAll('[data-node]')).forEach((nodeEl) => {
      let visible = !state.hiddenNodeTypes.has(nodeEl.dataset.type);
      if (nodeEl.dataset.layer && state.hiddenLayers.has(nodeEl.dataset.layer)) visible = false;
      nodeEl.style.display = visible ? '' : 'none';
      nodeEl.classList.toggle('dimmed', Boolean(visible && neighborIds && !neighborIds.has(nodeEl.dataset.node)));
      nodeEl.classList.toggle('selected', nodeEl.dataset.node === selected);
    });

    Array.from(dom.nodeLayer.querySelectorAll('.column-head')).forEach((head) => {
      head.style.display = state.hiddenLayers.has(head.dataset.layer) ? 'none' : '';
    });

    Array.from(dom.nodeLayer.querySelectorAll('.flow-card')).forEach((card) => {
      const head = card.querySelector('.flow-head');
      card.style.display = head && head.style.display === 'none' ? 'none' : '';
    });

    Array.from(dom.edgeLayer.querySelectorAll('path.edge')).forEach((path) => {
      const srcEl = state.nodeEls.get(path.dataset.source);
      const tgtEl = state.nodeEls.get(path.dataset.target);
      const hidden = state.hiddenEdgeTypes.has(path.dataset.type) ||
        (srcEl && srcEl.style.display === 'none') ||
        (tgtEl && tgtEl.style.display === 'none');
      path.style.display = hidden ? 'none' : '';
      path.classList.toggle('hl', Boolean(selected) && (path.dataset.source === selected || path.dataset.target === selected));
      path.classList.toggle('dimmed', Boolean(selected) && path.dataset.source !== selected && path.dataset.target !== selected);
    });
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ============================ 选择与详情 ============================ */
  function selectNode(id, opts) {
    const options = opts || {};
    if (!state.nodeMap.has(id)) return;
    state.selectedId = id;
    applyFilters();
    renderDetails(id);
    if (options.center && state.positions.has(id)) centerOn(id);
    dom.searchResults.textContent = '';
  }

  function clearSelection() {
    state.selectedId = null;
    applyFilters();
    dom.details.innerHTML = '<div class="detail-empty">在左侧画布中选择一个节点，这里会显示它的说明、标签与关联关系。</div>';
  }

  function relationsOf(id) {
    const outgoing = [];
    const incoming = [];
    (state.graph.edges || []).forEach((edge) => {
      if (edge.source === id) outgoing.push(edge);
      else if (edge.target === id) incoming.push(edge);
    });
    return { outgoing, incoming };
  }

  function relationHtml(edge, dir) {
    const otherId = dir === 'out' ? edge.target : edge.source;
    const name = nodeName(otherId);
    return '<div class="rel" data-goto="' + esc(otherId) + '">' +
      '<span class="rel-type">' + esc(edgeLabel(edge.type)) + '</span>' +
      '<span class="rel-name">' + esc(name) + '</span></div>';
  }

  function renderDetails(id) {
    const node = state.nodeMap.get(id);
    if (!node) return;
    const rel = relationsOf(id);
    const meta = node.domainMeta || {};
    let html = '';

    html += '<div class="detail-head">';
    html += '<h2 class="detail-name">' + esc(node.name) + '</h2>';
    html += '<div class="detail-badges">';
    html += '<span class="badge" style="color:' + typeColor(node.type) + '">' + esc(typeLabel(node.type)) + '</span>';
    if (node.complexity) {
      html += '<span class="badge" data-cx="' + esc(node.complexity) + '">复杂度 ' +
        esc(complexityLabel(node.complexity)) + '</span>';
    }
    html += '</div></div>';

    if (node.summary) {
      html += '<div class="detail-block"><h4>说明</h4><p>' + esc(node.summary) + '</p></div>';
    }
    if (node.filePath) {
      html += '<div class="detail-block"><h4>文件路径</h4><div class="path-line">' + esc(node.filePath) + '</div>' +
        '<button class="btn primary source-btn" type="button" data-source="' + esc(node.filePath) + '">查看源码</button></div>';
    }
    if (Array.isArray(node.tags) && node.tags.length) {
      html += '<div class="detail-block"><h4>标签</h4><div class="tag-row">';
      node.tags.forEach((tag) => { html += '<span class="tag">' + esc(tag) + '</span>'; });
      html += '</div></div>';
    }
    if (node.languageNotes) {
      html += '<div class="detail-block"><h4>语言注解</h4><p>' + esc(node.languageNotes) + '</p></div>';
    }

    if (node.type === 'domain') {
      if (Array.isArray(meta.entities) && meta.entities.length) {
        html += '<div class="detail-block"><h4>核心实体</h4><ul>';
        meta.entities.forEach((x) => { html += '<li>' + esc(x) + '</li>'; });
        html += '</ul></div>';
      }
      if (Array.isArray(meta.businessRules) && meta.businessRules.length) {
        html += '<div class="detail-block"><h4>业务规则</h4><ul>';
        meta.businessRules.forEach((x) => { html += '<li>' + esc(x) + '</li>'; });
        html += '</ul></div>';
      }
      if (Array.isArray(meta.crossDomainInteractions) && meta.crossDomainInteractions.length) {
        html += '<div class="detail-block"><h4>跨域交互</h4><ul>';
        meta.crossDomainInteractions.forEach((x) => { html += '<li>' + esc(x) + '</li>'; });
        html += '</ul></div>';
      }
    }

    if (meta.entryPoint) {
      html += '<div class="detail-block"><h4>入口</h4><div class="path-line">' + esc(meta.entryPoint) + '</div></div>';
    }

    const groups = [
      { key: 'out', title: '指向', list: rel.outgoing },
      { key: 'in', title: '来自', list: rel.incoming },
    ];
    let relHtml = '';
    groups.forEach((group) => {
      if (!group.list.length) return;
      const shown = group.list.slice(0, 40);
      relHtml += '<div class="rel-group"><div class="rg-title">' + group.title + '（' + group.list.length + '）</div>';
      shown.forEach((edge) => { relHtml += relationHtml(edge, group.key); });
      if (group.list.length > shown.length) {
        relHtml += '<div class="rg-title">另有 ' + (group.list.length - shown.length) + ' 条未显示</div>';
      }
      relHtml += '</div>';
    });
    if (relHtml) html += '<div class="detail-block"><h4>关联关系</h4>' + relHtml + '</div>';

    dom.details.innerHTML = html;
  }

  /* ============================ 导览 ============================ */
  function tourSteps() {
    const graph = state.data && state.data.knowledge;
    return graph && Array.isArray(graph.tour) ? graph.tour : [];
  }

  function updateTourToggle() {
    const steps = tourSteps();
    dom.tourToggle.disabled = !steps.length || state.tab !== 'knowledge';
    dom.tourToggle.classList.toggle('active', state.tourActive && state.tab === 'knowledge');
  }

  function toggleTour(force) {
    const active = typeof force === 'boolean' ? force : !state.tourActive;
    if (active && !tourSteps().length) return;
    if (active) {
      state.tourIndex = 0;
      state.tourActive = true;
      if (state.tab !== 'knowledge') switchTab('knowledge');
      else renderTourStep();
    } else {
      state.tourActive = false;
      dom.tourBar.classList.add('hidden');
      Array.from(dom.nodeLayer.querySelectorAll('.tour-hit')).forEach((n) => n.classList.remove('tour-hit'));
      updateTourToggle();
    }
  }

  function goTourStep(index) {
    const steps = tourSteps();
    if (!steps.length) return;
    if (state.tab !== 'knowledge') switchTab('knowledge');
    state.tourIndex = Math.max(0, Math.min(steps.length - 1, index));
    state.tourActive = true;
    renderTourStep();
  }

  function renderTourStep() {
    const steps = tourSteps();
    const step = steps[state.tourIndex];
    dom.tourBar.classList.remove('hidden');
    updateTourToggle();

    Array.from(dom.nodeLayer.querySelectorAll('.tour-hit')).forEach((n) => n.classList.remove('tour-hit'));
    if (!step) return;

    const ids = Array.isArray(step.nodeIds) ? step.nodeIds : [];
    // 默认只显示第一个图层，导览涉及的节点自动取消隐藏
    let needRefresh = false;
    ids.forEach((id) => {
      const pos = state.positions.get(id);
      const node = state.nodeMap.get(id);
      if (pos && pos.layer && state.hiddenLayers.has(pos.layer)) {
        state.hiddenLayers.delete(pos.layer);
        needRefresh = true;
      }
      if (node && state.hiddenNodeTypes.has(node.type)) {
        state.hiddenNodeTypes.delete(node.type);
        needRefresh = true;
      }
    });
    if (needRefresh) {
      buildFilterPanels();
      applyFilters();
    }
    ids.forEach((id) => {
      const target = dom.nodeLayer.querySelector('[data-node="' + cssEscape(id) + '"]');
      if (target) target.classList.add('tour-hit');
    });
    if (ids.length && state.positions.has(ids[0])) selectNode(ids[0], { center: true });

    dom.tourBar.textContent = '';
    const head = el('div', 'tour-head');
    head.appendChild(el('span', 'tour-step', '导览 ' + (state.tourIndex + 1) + ' / ' + steps.length));
    head.appendChild(el('span', 'tour-title', step.title || ''));
    const close = el('button', 'tour-close', '×');
    close.type = 'button';
    close.title = '关闭导览';
    close.addEventListener('click', () => toggleTour(false));
    head.appendChild(close);
    dom.tourBar.appendChild(head);

    if (step.description) dom.tourBar.appendChild(el('p', 'tour-desc', step.description));
    if (step.languageLesson) {
      const lesson = el('div', 'tour-lesson');
      lesson.innerHTML = '<b>语言注解</b> ' + esc(step.languageLesson);
      dom.tourBar.appendChild(lesson);
    }

    const foot = el('div', 'tour-foot');
    ids.forEach((id) => {
      const chip = el('button', 'tour-chip', nodeName(id));
      chip.type = 'button';
      chip.addEventListener('click', () => selectNode(id, { center: true }));
      foot.appendChild(chip);
    });
    foot.appendChild(el('span', 'spacer'));
    const prev = el('button', 'btn', '上一步');
    prev.type = 'button';
    prev.disabled = state.tourIndex === 0;
    prev.addEventListener('click', () => goTourStep(state.tourIndex - 1));
    const next = el('button', 'btn primary', state.tourIndex === steps.length - 1 ? '完成' : '下一步');
    next.type = 'button';
    next.addEventListener('click', () => {
      if (state.tourIndex === steps.length - 1) toggleTour(false);
      else goTourStep(state.tourIndex + 1);
    });
    foot.appendChild(prev);
    foot.appendChild(next);
    dom.tourBar.appendChild(foot);
  }

  /* ============================ 视图 ============================ */
  function applyView() {
    dom.world.style.transform =
      'translate(' + state.view.x + 'px,' + state.view.y + 'px) scale(' + state.view.k + ')';
  }

  function visibleBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    state.nodeEls.forEach((nodeEl, id) => {
      if (nodeEl.style.display === 'none') return;
      const pos = state.positions.get(id);
      if (!pos) return;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y - 44);
      maxX = Math.max(maxX, pos.x + pos.w);
      maxY = Math.max(maxY, pos.y + pos.h);
    });
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function resetView() {
    const rect = dom.canvasWrap.getBoundingClientRect();
    const pad = 56;
    const bounds = visibleBounds() || { x: 0, y: 0, w: state.world.w, h: state.world.h };
    const k = Math.min(
      (rect.width - pad * 2) / Math.max(1, bounds.w),
      (rect.height - pad * 2) / Math.max(1, bounds.h),
      1.15
    );
    const scale = Math.max(0.05, k);
    state.view = {
      k: scale,
      x: (rect.width - bounds.w * scale) / 2 - bounds.x * scale,
      y: (rect.height - bounds.h * scale) / 2 - bounds.y * scale,
    };
    applyView();
  }

  function zoomBy(factor, cx, cy) {
    const rect = dom.canvasWrap.getBoundingClientRect();
    const px = cx == null ? rect.width / 2 : cx;
    const py = cy == null ? rect.height / 2 : cy;
    const old = state.view.k;
    const next = Math.min(2.5, Math.max(0.12, old * factor));
    state.view.x = px - (px - state.view.x) * (next / old);
    state.view.y = py - (py - state.view.y) * (next / old);
    state.view.k = next;
    applyView();
  }

  function focusLayer(layerId) {
    const box = state.layerBoxes.find((b) => b.id === layerId);
    if (!box) return;
    const rect = dom.canvasWrap.getBoundingClientRect();
    const k = Math.min(1.1, Math.max(0.55, (rect.height - 140) / Math.max(1, box.h)));
    state.view.k = k;
    state.view.x = rect.width / 2 - (box.x + box.w / 2) * k;
    state.view.y = rect.height / 2 - (box.y - 44 + box.h / 2) * k;
    applyView();
    Array.from(dom.layerFilters.querySelectorAll('.layer-item')).forEach((row) => {
      row.classList.toggle('active', row.dataset.layer === layerId);
    });
  }

  function centerOn(id) {
    const pos = state.positions.get(id);
    if (!pos) return;
    const rect = dom.canvasWrap.getBoundingClientRect();
    const k = Math.max(state.view.k, 0.72);
    state.view.k = k;
    state.view.x = rect.width / 2 - (pos.x + pos.w / 2) * k;
    state.view.y = rect.height / 2 - (pos.y + pos.h / 2) * k;
    applyView();
  }

  /* ============================ 搜索 ============================ */
  function runSearch(keyword) {
    const kw = keyword.trim().toLowerCase();
    dom.searchResults.textContent = '';
    if (!kw || state.tab === 'overview' || !state.graph) return;

    const matches = (state.graph.nodes || []).filter((node) => {
      const hay = (node.name + ' ' + (node.id || '') + ' ' + (node.filePath || '') + ' ' +
        (node.tags || []).join(' ')).toLowerCase();
      return hay.indexOf(kw) !== -1;
    });

    matches.slice(0, 18).forEach((node) => {
      const row = el('div', 'search-result');
      const dot = el('span', 'dot');
      dot.style.setProperty('--c', typeColor(node.type));
      row.appendChild(dot);
      row.appendChild(el('span', 'sr-name', node.name));
      row.appendChild(el('span', 'sr-path', node.filePath || typeLabel(node.type)));
      row.addEventListener('click', () => {
        selectNode(node.id, { center: true });
        dom.searchInput.value = '';
        dom.searchResults.textContent = '';
      });
      dom.searchResults.appendChild(row);
    });
    if (matches.length > 18) {
      dom.searchResults.appendChild(el('div', 'search-more',
        '还有 ' + (matches.length - 18) + ' 个结果，请输入更精确的关键词'));
    }
  }

  /* ============================ 源码查看 ============================ */
  let sourcesPromise = null;
  let modalEls = null;

  function ensureModal() {
    if (modalEls) return modalEls;
    const mask = el('div', 'modal-mask');
    const modal = el('div', 'modal');
    const head = el('div', 'modal-head');
    const title = el('div', 'modal-title');
    const close = el('button', 'tour-close', '×');
    close.type = 'button';
    close.title = '关闭';
    head.appendChild(title);
    head.appendChild(close);
    const body = el('div', 'modal-body');
    modal.appendChild(head);
    modal.appendChild(body);
    mask.appendChild(modal);
    mask.style.display = 'none';
    document.body.appendChild(mask);
    close.addEventListener('click', closeModal);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
    modalEls = { mask, title, body };
    return modalEls;
  }

  function closeModal() {
    if (modalEls) modalEls.mask.style.display = 'none';
  }

  function modalOpen() {
    return Boolean(modalEls && modalEls.mask.style.display !== 'none');
  }

  function loadSources() {
    if (!sourcesPromise) {
      sourcesPromise = loadScript('system/data/' + encodeURIComponent(projectId) + '-sources.js')
        .then(() => (window.UA_SOURCES || {})[projectId] || null)
        .catch(() => null);
    }
    return sourcesPromise;
  }

  function findSourceFile(files, filePath) {
    const target = String(filePath).replace(/^\.\//, '').replace(/\\/g, '/');
    if (Object.prototype.hasOwnProperty.call(files, target)) return target;
    const keys = Object.keys(files);
    const lower = target.toLowerCase();
    let hit = keys.find((k) => k.toLowerCase() === lower);
    if (hit) return hit;
    hit = keys.find((k) => k.toLowerCase().endsWith('/' + lower));
    if (hit) return hit;
    hit = keys.find((k) => lower.endsWith('/' + k.toLowerCase()));
    return hit || null;
  }

  function showModalMessage(title, lines) {
    const m = ensureModal();
    m.title.textContent = title;
    m.body.textContent = '';
    lines.forEach((line) => {
      if (typeof line === 'string') m.body.appendChild(el('p', null, line));
      else m.body.appendChild(line);
    });
    m.mask.style.display = 'flex';
  }

  function showSourceHint(filePath) {
    const tip = el('div', 'modal-tip');
    tip.appendChild(el('p', null, '当前分享的数据包里没有携带源码内容。'));
    tip.appendChild(el('p', null, '源码请下载后放到下面这个目录（直接放在项目根目录，保持仓库原有目录结构）：'));
    const pathLine = el('div', 'path-line', 'datas/' + projectId + '/');
    tip.appendChild(pathLine);
    tip.appendChild(el('p', 'modal-note', '节点对应的源码路径为：' + filePath));
    showModalMessage('尚未包含源码', [tip]);
  }

  function projectManifest() {
    const list = (window.UA_MANIFEST && window.UA_MANIFEST.projects) || [];
    return list.find((item) => item.id === projectId) || null;
  }

  async function openSource(filePath) {
    const info = projectManifest();
    if (info && info.hasSources === false) {
      showSourceHint(filePath);
      return;
    }
    const bundle = await loadSources();
    if (!bundle || !bundle.files || !Object.keys(bundle.files).length) {
      showSourceHint(filePath);
      return;
    }
    const match = findSourceFile(bundle.files, filePath);
    if (!match) {
      showModalMessage('源码中未找到该文件', [
        '已加载该项目的源码，但没有匹配到节点对应的路径：',
        el('div', 'path-line', filePath),
      ]);
      return;
    }

    const content = bundle.files[match];
    const m = ensureModal();
    m.title.textContent = match;
    m.body.textContent = '';
    const code = el('div', 'code-view');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      const row = el('div', 'code-row');
      row.appendChild(el('span', 'code-ln', String(i + 1)));
      row.appendChild(el('span', 'code-text', line.replace(/\t/g, '    ')));
      code.appendChild(row);
    });
    m.body.appendChild(code);
    m.mask.style.display = 'flex';
  }

  /* ============================ 概览 ============================ */
  function renderOverview() {
    const kg = state.data.knowledge;
    const dg = state.data.domain;
    const meta = state.data.meta || {};
    const config = state.data.config || {};
    const project = (kg && kg.project) || (dg && dg.project) || {};
    const stat = (graph, key) => (graph && Array.isArray(graph[key]) ? graph[key].length : 0);

    let html = '<div class="ov-inner">';
    html += '<h2>' + esc(project.name || projectId) + '</h2>';
    html += '<div class="ov-sub">分析于 ' + esc(formatDate(project.analyzedAt || meta.lastAnalyzedAt)) + '</div>';
    if (project.description) html += '<p class="ov-desc">' + esc(project.description) + '</p>';

    html += '<div class="stat-grid">';
    if (kg) {
      html += '<div class="stat-card"><div class="sv">' + stat(kg, 'nodes') + '</div><div class="sl">知识图谱节点</div></div>';
      html += '<div class="stat-card"><div class="sv">' + stat(kg, 'edges') + '</div><div class="sl">知识图谱关系</div></div>';
      html += '<div class="stat-card"><div class="sv">' + stat(kg, 'layers') + '</div><div class="sl">图层</div></div>';
    }
    if (dg) {
      html += '<div class="stat-card"><div class="sv">' + stat(dg, 'nodes') + '</div><div class="sl">领域图谱节点</div></div>';
      html += '<div class="stat-card"><div class="sv">' + stat(dg, 'edges') + '</div><div class="sl">领域图谱关系</div></div>';
    }
    if (meta.analyzedFiles) {
      html += '<div class="stat-card"><div class="sv">' + esc(meta.analyzedFiles) + '</div><div class="sl">已分析文件</div></div>';
    }
    html += '</div>';

    if ((project.languages || []).length || (project.frameworks || []).length) {
      html += '<div class="ov-section"><h3>技术栈</h3><div class="tag-row">';
      (project.frameworks || []).forEach((t) => { html += '<span class="tag">' + esc(t) + '</span>'; });
      (project.languages || []).forEach((t) => { html += '<span class="tag">' + esc(t) + '</span>'; });
      html += '</div></div>';
    }

    html += '<div class="ov-section"><h3>分析信息</h3><dl class="kv">';
    html += '<dt>项目目录</dt><dd>datas/' + esc(projectId) + '</dd>';
    html += '<dt>分析时间</dt><dd>' + esc(formatDate(project.analyzedAt || meta.lastAnalyzedAt)) + '</dd>';
    if (project.gitCommitHash || meta.gitCommitHash) {
      html += '<dt>Git 提交</dt><dd>' + esc(project.gitCommitHash || meta.gitCommitHash) + '</dd>';
    }
    if (meta.version) html += '<dt>分析器版本</dt><dd>' + esc(meta.version) + '</dd>';
    if (config.outputLanguage) html += '<dt>输出语言</dt><dd>' + esc(config.outputLanguage) + '</dd>';
    if (meta.analyzedFiles) html += '<dt>分析文件数</dt><dd>' + esc(meta.analyzedFiles) + '</dd>';
    html += '</dl></div>';

    if (kg && Array.isArray(kg.layers) && kg.layers.length) {
      html += '<div class="ov-section"><h3>图层说明</h3><div class="layer-desc-list">';
      kg.layers.forEach((layer) => {
        html += '<div class="layer-desc"><div class="ld-head"><span class="ld-name">' + esc(layer.name) +
          '</span><span class="ld-count">' + (layer.nodeIds || []).length + ' 个节点</span></div>';
        if (layer.description) html += '<p>' + esc(layer.description) + '</p>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    if (dg) {
      const domains = (dg.nodes || []).filter((n) => n.type === 'domain');
      if (domains.length) {
        html += '<div class="ov-section"><h3>业务域</h3><div class="tag-row">';
        domains.forEach((domain, i) => {
          html += '<span class="tag ov-domain" data-domain="' + esc(domain.id) + '" style="cursor:pointer">' +
            esc(domain.name) + '</span>';
        });
        html += '</div></div>';
      }
    }

    if (kg && Array.isArray(kg.tour) && kg.tour.length) {
      html += '<div class="ov-section"><h3>代码导览</h3><div class="tour-list">';
      kg.tour.forEach((step, i) => {
        html += '<div class="tour-entry" data-index="' + i + '"><span class="te-idx">' +
          (i + 1) + '</span><span>' + esc(step.title || '') + '</span></div>';
      });
      html += '</div></div>';
    }

    html += '</div>';
    dom.overview.innerHTML = html;

    Array.from(dom.overview.querySelectorAll('.tour-entry')).forEach((row) => {
      row.addEventListener('click', () => {
        if (!state.data.knowledge) return;
        switchTab('knowledge');
        goTourStep(Number(row.dataset.index) || 0);
      });
    });
    Array.from(dom.overview.querySelectorAll('.ov-domain')).forEach((chip) => {
      chip.addEventListener('click', () => {
        if (!state.data.domain) return;
        switchTab('domain');
        selectNode(chip.dataset.domain);
      });
    });
  }

  /* ============================ 交互绑定 ============================ */
  let drag = null;

  dom.canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.tour-bar') || e.target.closest('.overview')) return;
    e.preventDefault();
    drag = { sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y, moved: false };
    try { dom.canvasWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  dom.canvasWrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      dom.canvasWrap.classList.add('dragging');
    }
    if (drag.moved) {
      state.view.x = drag.ox + dx;
      state.view.y = drag.oy + dy;
      applyView();
    }
  });

  dom.canvasWrap.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    dom.canvasWrap.classList.remove('dragging');
    try { dom.canvasWrap.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (moved) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const target = hit && hit.closest ? hit.closest('[data-node]') : null;
    if (target) selectNode(target.dataset.node);
    else if (hit === dom.canvasWrap || hit === dom.nodeLayer || hit === dom.world) clearSelection();
  });

  dom.canvasWrap.addEventListener('wheel', (e) => {
    if (state.tab === 'overview') return;
    e.preventDefault();
    const rect = dom.canvasWrap.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  dom.zoomIn.addEventListener('click', () => zoomBy(1.25));
  dom.zoomOut.addEventListener('click', () => zoomBy(0.8));
  dom.zoomFit.addEventListener('click', () => {
    if (state.tab === 'domain') {
      state.view = { k: 0.82, x: 24, y: 16 };
      applyView();
    } else {
      resetView();
    }
  });
  dom.tourToggle.addEventListener('click', () => toggleTour());

  dom.searchInput.addEventListener('input', () => runSearch(dom.searchInput.value));
  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dom.searchInput.value = '';
      dom.searchResults.textContent = '';
      dom.searchInput.blur();
    }
  });
  dom.searchInput.addEventListener('blur', () => {
    setTimeout(() => { dom.searchResults.textContent = ''; }, 150);
  });
  dom.searchResults.addEventListener('mousedown', (e) => e.preventDefault());

  dom.details.addEventListener('click', (e) => {
    const sourceBtn = e.target.closest('[data-source]');
    if (sourceBtn) {
      openSource(sourceBtn.dataset.source);
      return;
    }
    const rel = e.target.closest('[data-goto]');
    if (!rel) return;
    selectNode(rel.dataset.goto, { center: state.positions.has(rel.dataset.goto) });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalOpen()) {
      closeModal();
      return;
    }
    if (!document.activeElement.matches('input')) clearSelection();
  });

  /* ============================ 侧栏折叠 ============================ */
  function setSidebarCollapsed(side, collapsed) {
    document.body.classList.toggle(side + '-collapsed', collapsed);
    const btn = side === 'left' ? dom.toggleLeft : dom.toggleRight;
    if (!btn) return;
    const name = side === 'left' ? '左侧栏' : '右侧栏';
    btn.textContent = collapsed ? (side === 'left' ? '›' : '‹') : (side === 'left' ? '‹' : '›');
    btn.title = (collapsed ? '展开' : '收起') + name;
  }

  if (dom.toggleLeft) {
    dom.toggleLeft.addEventListener('click', () => {
      setSidebarCollapsed('left', !document.body.classList.contains('left-collapsed'));
    });
  }
  if (dom.toggleRight) {
    dom.toggleRight.addEventListener('click', () => {
      setSidebarCollapsed('right', !document.body.classList.contains('right-collapsed'));
    });
  }
  if (dom.nodeTypesAll) dom.nodeTypesAll.addEventListener('click', () => toggleAll('node'));
  if (dom.edgeTypesAll) dom.edgeTypesAll.addEventListener('click', () => toggleAll('edge'));
  if (dom.layersAll) dom.layersAll.addEventListener('click', () => toggleAll('layer'));

  boot();
})();
