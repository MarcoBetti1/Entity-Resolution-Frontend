const state = {
  settings: null,
  summary: null,
  filters: {
    min_risk: 0,
    min_total: 0,
    max_total: 0,
    start_date: null,
    end_date: null,
    reported_only: false,
  },
  groups: [],
  selectedGroupId: null,
  reports: [],
  snapshots: [],
  snapshotTotal: 0,
  snapshotLimit: 100,
  network: null,
};

const dom = {
  title: document.getElementById('app-title'),
  refreshArtifacts: document.getElementById('refresh-artifacts'),
  filterForm: document.getElementById('filter-form'),
  resetFilters: document.getElementById('reset-filters'),
  minRisk: document.getElementById('min-risk'),
  minTotal: document.getElementById('min-total'),
  maxTotal: document.getElementById('max-total'),
  startDate: document.getElementById('start-date'),
  endDate: document.getElementById('end-date'),
  reportedOnly: document.getElementById('reported-only'),
  summaryInfo: document.getElementById('summary-info'),
  groupsTableContainer: document.getElementById('groups-table-container'),
  detailContainer: document.getElementById('detail-container'),
  datasetInfo: document.getElementById('dataset-info'),
  snapshotList: document.getElementById('snapshot-list'),
  networkContainer: document.getElementById('network-container'),
  networkStatus: document.getElementById('network-status'),
  networkGraph: document.getElementById('network-graph'),
  networkTable: document.getElementById('network-table-container'),
  reportList: document.getElementById('report-list'),
  footerRun: document.getElementById('footer-run'),
  footerGenerated: document.getElementById('footer-generated'),
  footerReports: document.getElementById('footer-reports'),
};

let networkGraphInstance = null;

class SimpleForceGraph {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.options = options;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'network-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'network-tooltip hidden';
    this.mount.innerHTML = '';
    this.mount.appendChild(this.canvas);
    this.mount.appendChild(this.tooltip);
    this.nodes = [];
    this.links = [];
    this.hoverNode = null;
    this.activeNodeId = null;
    this.animationFrame = null;
    this.dpr = window.devicePixelRatio || 1;
    this.idleFrames = 0;
    this.running = false;
    this.handleResize = this.handleResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onPointerClick = this.onPointerClick.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.canvas.addEventListener('mousemove', this.onPointerMove);
    this.canvas.addEventListener('mouseleave', this.onPointerLeave);
    this.canvas.addEventListener('click', this.onPointerClick);
    this.handleResize();
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('mousemove', this.onPointerMove);
    this.canvas.removeEventListener('mouseleave', this.onPointerLeave);
    this.canvas.removeEventListener('click', this.onPointerClick);
    this.mount.innerHTML = '';
    this.nodes = [];
    this.links = [];
  }

  handleResize() {
    const rect = this.mount.getBoundingClientRect();
    this.width = Math.max(rect.width, 1);
    this.height = Math.max(rect.height, 1);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  setData(rawNodes, rawLinks) {
    const existing = new Map(this.nodes.map((node) => [node.id, node]));
    const baseNodes = rawNodes.map((node) => {
      const previous = existing.get(node.id);
      return {
        ...node,
        x: previous?.x ?? Math.random() * this.width,
        y: previous?.y ?? Math.random() * this.height,
        vx: previous?.vx ?? 0,
        vy: previous?.vy ?? 0,
        radius: node.kind === 'group' ? (node.highlight ? 13 : 11) : 7,
      };
    });
    const nodeMap = new Map(baseNodes.map((node) => [node.id, node]));
    const links = rawLinks
      .map((link) => {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);
        if (!source || !target) return null;
        const amountValue = Number.isFinite(link.amount) ? link.amount : Number(link.amount) || 0;
        const baseLength = this.options.springLength ?? 140;
        const amountFactor = Math.log10(amountValue + 1);
        return {
          source,
          target,
          amount: amountValue,
          count: link.count,
          label: link.label,
          width: Math.max(1, amountFactor),
          directions: link.directions,
          length: Math.max(80, baseLength - amountFactor * 12),
        };
      })
      .filter(Boolean);
    this.nodes = baseNodes;
    this.links = links;
    this.hoverNode = null;
    this.tooltip.classList.add('hidden');
    if (!this.nodes.length) {
      this.stop();
      this.draw();
      return;
    }
    this.draw();
    this.start();
  }

  setActiveNode(nodeId) {
    this.activeNodeId = nodeId;
    this.draw();
  }

  start() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.running = true;
    this.idleFrames = 0;
    const tick = () => {
      if (!this.running) {
        this.animationFrame = null;
        return;
      }
      this.step();
      this.draw();
      if (this.running) {
        if (this.idleFrames > 180) {
          this.running = false;
          this.animationFrame = null;
        } else {
          this.animationFrame = requestAnimationFrame(tick);
        }
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.running = false;
  }

  step() {
    const nodes = this.nodes;
    const links = this.links;
    const repulsion = this.options.repulsion ?? 2200;
    const springStrength = this.options.springStrength ?? 0.06;
    const springLength = this.options.springLength ?? 140;
    const centerStrength = this.options.centerStrength ?? 0.02;
    const damping = this.options.damping ?? 0.86;
    let maxVelocity = 0;

    for (const node of nodes) {
      node.fx = 0;
      node.fy = 0;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        let dx = nodeB.x - nodeA.x;
        let dy = nodeB.y - nodeA.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq === 0) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distanceSq = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSq);
        const force = repulsion / distanceSq;
        const fx = force * (dx / distance);
        const fy = force * (dy / distance);
        nodeA.fx -= fx;
        nodeA.fy -= fy;
        nodeB.fx += fx;
        nodeB.fy += fy;
      }
    }

    for (const link of links) {
      const { source, target } = link;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const desired = link.length ?? springLength;
      const delta = distance - desired;
      const force = springStrength * delta;
      const fx = force * (dx / distance);
      const fy = force * (dy / distance);
      source.fx += fx;
      source.fy += fy;
      target.fx -= fx;
      target.fy -= fy;
    }

    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const node of nodes) {
      node.fx += (centerX - node.x) * centerStrength;
      node.fy += (centerY - node.y) * centerStrength;
      node.vx = (node.vx + node.fx) * damping;
      node.vy = (node.vy + node.fy) * damping;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(node.radius, Math.min(this.width - node.radius, node.x));
      node.y = Math.max(node.radius, Math.min(this.height - node.radius, node.y));
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > maxVelocity) {
        maxVelocity = speed;
      }
    }

    if (maxVelocity < 0.04) {
      this.idleFrames += 1;
    } else {
      this.idleFrames = 0;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.globalAlpha = 0.7;
    ctx.lineCap = 'round';
    for (const link of this.links) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = link.width;
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (const node of this.nodes) {
      ctx.beginPath();
      ctx.fillStyle = node.color;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.8)';
      ctx.shadowBlur = this.activeNodeId === node.id ? 12 : 6;
      const radius = node.radius + (this.activeNodeId === node.id ? 3 : 0);
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (this.hoverNode && this.hoverNode.id === node.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
        ctx.stroke();
      } else if (this.activeNodeId === node.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
        ctx.stroke();
      } else if (node.highlight) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
        ctx.stroke();
      }
      if (node.kind === 'group') {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.font = '12px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.label ?? node.id, node.x, node.y - radius - 8);
      }
    }
    ctx.restore();
  }

  onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const threshold = 18;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const node of this.nodes) {
      const dx = pointerX - node.x;
      const dy = pointerY - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < Math.max(threshold, node.radius + 6) && distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      this.hoverNode = nearest;
      this.tooltip.classList.remove('hidden');
      const clampedX = Math.max(12, Math.min(this.width - 12, nearest.x));
      const clampedY = Math.max(24, Math.min(this.height - 12, nearest.y));
      this.tooltip.style.left = `${clampedX}px`;
      this.tooltip.style.top = `${clampedY}px`;
      this.tooltip.innerHTML = this.buildTooltip(nearest);
      this.draw();
    } else {
      this.hoverNode = null;
      this.tooltip.classList.add('hidden');
      this.draw();
    }
  }

  onPointerLeave() {
    this.hoverNode = null;
    this.tooltip.classList.add('hidden');
    this.draw();
  }

  onPointerClick() {
    if (!this.hoverNode) return;
    if (typeof this.options.onNodeClick === 'function') {
      this.options.onNodeClick(this.hoverNode);
    }
  }

  buildTooltip(node) {
    if (node.kind === 'group') {
      return `
        <div class="tooltip-title">${node.label ?? node.id}</div>
        <div class="tooltip-line">Risk: ${node.risk_score ?? '—'}</div>
        <div class="tooltip-line">Members: ${node.member_count ?? '—'}</div>
        <div class="tooltip-line">Total: ${formatCurrency(node.total_amount)}</div>
      `.trim();
    }
    return `
      <div class="tooltip-title">${node.label ?? node.id}</div>
      <div class="tooltip-line">${node.kind ?? ''}</div>
    `.trim();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function formatNumber(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, options).format(value);
}

function formatCurrency(value) {
  return formatNumber(value, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatDate(date) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(date));
  } catch (err) {
    console.warn('Unable to format date', date, err);
    return date;
  }
}

function normaliseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 0);
  }
  return date.toISOString();
}

function assignFiltersFromSummary() {
  const aggregated = state.summary?.aggregated ?? {};
  dom.minRisk.value = aggregated.min_risk ?? 0;
  dom.minTotal.value = aggregated.min_total_amount ?? 0;
  dom.maxTotal.value = aggregated.max_total_amount ?? (aggregated.min_total_amount ?? 0);
  dom.startDate.value = aggregated.min_date ? aggregated.min_date.slice(0, 10) : '';
  dom.endDate.value = aggregated.max_date ? aggregated.max_date.slice(0, 10) : '';
  dom.reportedOnly.checked = false;
}

function readFiltersFromForm() {
  const minRisk = Number(dom.minRisk.value) || 0;
  const minTotal = Number(dom.minTotal.value) || 0;
  const maxTotalRaw = dom.maxTotal.value;
  const maxTotal = maxTotalRaw === '' ? Number.MAX_SAFE_INTEGER : Number(maxTotalRaw);
  const startDate = normaliseDateInput(dom.startDate.value, false);
  const endDate = normaliseDateInput(dom.endDate.value, true);
  state.filters = {
    min_risk: minRisk,
    min_total: minTotal,
    max_total: maxTotal,
    start_date: startDate,
    end_date: endDate,
    reported_only: dom.reportedOnly.checked,
  };
}

function buildQueryParams(filters) {
  const params = new URLSearchParams();
  params.set('min_risk', filters.min_risk);
  params.set('min_total', filters.min_total);
  params.set('max_total', filters.max_total);
  if (filters.start_date) params.set('start_date', filters.start_date);
  if (filters.end_date) params.set('end_date', filters.end_date);
  if (filters.reported_only) params.set('reported_only', 'true');
  return params.toString();
}

function renderSummaryInfo() {
  if (!state.summary) {
    dom.summaryInfo.textContent = 'Unable to load dataset summary.';
    return;
  }
  const aggregated = state.summary.aggregated;
  const fragments = [];
  fragments.push(`<span class="summary-pill">Groups: ${state.summary.total_groups}</span>`);
  if (state.summary.total_records !== null && state.summary.total_records !== undefined) {
    fragments.push(`<span class="summary-pill">Records: ${state.summary.total_records}</span>`);
  }
  if (aggregated.min_risk !== null && aggregated.max_risk !== null) {
    fragments.push(`<span class="summary-pill">Risk range: ${aggregated.min_risk} – ${aggregated.max_risk}</span>`);
  }
  if (aggregated.min_total_amount !== null && aggregated.max_total_amount !== null) {
    fragments.push(`<span class="summary-pill">Total amount: ${formatCurrency(aggregated.min_total_amount)} – ${formatCurrency(aggregated.max_total_amount)}</span>`);
  }
  dom.summaryInfo.innerHTML = fragments.join('');
  const runMeta = state.summary.summary_metadata ?? {};
  dom.footerRun.textContent = runMeta.run_id ? `Run: ${runMeta.run_id}` : '';
  dom.footerGenerated.textContent = runMeta.generated_at ? `Generated: ${formatDate(runMeta.generated_at)}` : '';
  renderDatasetInfo();
}

function renderDatasetInfo() {
  const container = dom.datasetInfo;
  if (!container) return;
  if (!state.summary) {
    container.innerHTML = '<p class="empty-state">Summary not loaded.</p>';
    return;
  }
  const meta = state.summary.summary_metadata ?? {};
  const info = {
    'Run label': meta.label ?? '—',
    'Run id': meta.run_id ?? '—',
    'Generated at': meta.generated_at ? formatDate(meta.generated_at) : '—',
    'Total records': state.summary.total_records ?? '—',
    'Deterministic thresholds': Array.isArray(meta.deterministic_thresholds) && meta.deterministic_thresholds.length
      ? meta.deterministic_thresholds.join(', ')
      : '—',
    'Similarity threshold': meta.similarity_threshold ?? '—',
  };
  const weights = meta.attribute_weights;
  container.innerHTML = `
    ${buildKeyValueTable(info)}
    ${weights ? `<details><summary>Attribute weights</summary><pre>${JSON.stringify(weights, null, 2)}</pre></details>` : ''}
  `;
}

function createRiskPill(risk) {
  let level = 'risk-low';
  if (risk >= 80) level = 'risk-high';
  else if (risk >= 60) level = 'risk-medium';
  return `<span class="status-pill ${level}">Risk ${risk}</span>`;
}

function renderGroupsTable() {
  if (!state.groups.length) {
    dom.groupsTableContainer.innerHTML = '<p class="empty-state">No groups match the current filters.</p>';
    return;
  }
  const rows = state.groups.map((item) => {
    const reportedBadge = item.reported ? '<span class="badge">Reported</span>' : '';
    return `<tr data-group-id="${item.group_id}" class="${state.selectedGroupId === item.group_id ? 'selected' : ''}">
      <td><strong>${item.group_id}</strong><br>${item.display_name ?? ''}</td>
      <td>${createRiskPill(item.metrics.risk_score)} ${reportedBadge}</td>
      <td>${item.metrics.member_count}</td>
      <td>${item.metrics.transaction_count}</td>
      <td>${formatCurrency(item.metrics.total_amount)}</td>
    </tr>`;
  }).join('');
  dom.groupsTableContainer.innerHTML = `<table class="data-table">
    <thead>
      <tr>
        <th>Group</th>
        <th>Risk</th>
        <th>Members</th>
        <th>Transactions</th>
        <th>Total Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
  dom.groupsTableContainer.querySelectorAll('tbody tr').forEach((row) => {
    row.addEventListener('click', () => {
      const groupId = row.getAttribute('data-group-id');
      state.selectedGroupId = groupId;
      renderGroupsTable();
      loadGroupDetail(groupId);
    });
  });
  if (networkGraphInstance) {
    networkGraphInstance.setActiveNode(state.selectedGroupId);
  }
}

function renderSnapshotList() {
  const list = dom.snapshotList;
  if (!list) return;
  if (!state.snapshots.length) {
    list.innerHTML = '<li class="snapshot-item">No snapshot records loaded.</li>';
    return;
  }
  list.innerHTML = state.snapshots
    .map((snapshot) => {
      const taxId = snapshot?.normalized_attributes?.tax_id
        ?? snapshot?.attributes?.tax_id
        ?? '—';
      const signature = snapshot?.signature
        ?? (Array.isArray(snapshot?.signature_history) && snapshot.signature_history.length
          ? snapshot.signature_history[0]
          : null);
      const details = JSON.stringify({
        attributes: snapshot.attributes,
        normalized_attributes: snapshot.normalized_attributes,
      }, null, 2);
      return `<li class="snapshot-item">
        <strong>${snapshot.record_id ?? 'Record'}</strong>
        <span>${snapshot.entity_type ?? 'entity'} • Tax ID ${taxId}</span>
        ${signature ? `<span class="badge">Signature: ${signature}</span>` : ''}
        <details><summary>View attributes</summary><pre>${details}</pre></details>
      </li>`;
    })
    .join('');
  if (state.snapshotTotal > state.snapshots.length) {
    list.insertAdjacentHTML('beforeend', `<li class="snapshot-item">Showing first ${state.snapshots.length} of ${state.snapshotTotal} snapshots.</li>`);
  }
}

function showNetworkPlaceholder(message, persistent = false) {
  if (!dom.networkStatus || !dom.networkGraph || !dom.networkTable) return;
  if (networkGraphInstance) {
    networkGraphInstance.destroy();
    networkGraphInstance = null;
  }
  dom.networkStatus.textContent = message;
  dom.networkStatus.dataset.persistent = persistent ? 'true' : 'false';
  dom.networkStatus.classList.remove('hidden');
  dom.networkGraph.classList.add('hidden');
  dom.networkTable.classList.add('hidden');
}

function renderNetworkTable(network) {
  if (!dom.networkTable) return;
  if (dom.networkStatus && dom.networkStatus.dataset.persistent !== 'true') {
    dom.networkStatus.classList.add('hidden');
  }
  if (!network || !network.edges.length) {
    dom.networkTable.innerHTML = '<p class="empty-state">No transactional edges available for the current filters.</p>';
    dom.networkTable.classList.remove('hidden');
    return;
  }
  const edges = network.edges
    .map((edge) => `<tr>
      <td>${edge.source}</td>
      <td>${edge.target}</td>
      <td>${formatCurrency(edge.amount)}</td>
      <td>${edge.count}</td>
      <td>${edge.directions.join(', ') || '—'}</td>
    </tr>`)
    .join('');
  dom.networkTable.innerHTML = `<table class="network-table">
    <thead><tr><th>Source</th><th>Target</th><th>Amount</th><th>Count</th><th>Directions</th></tr></thead>
    <tbody>${edges}</tbody>
  </table>`;
  dom.networkTable.classList.remove('hidden');
}

function renderNetworkGraph(network) {
  if (!dom.networkGraph) return;
  if (!network || !network.nodes.length) {
    showNetworkPlaceholder('No network data available for the current filters.');
    return;
  }
  if (dom.networkStatus) {
    dom.networkStatus.classList.add('hidden');
    dom.networkStatus.dataset.persistent = 'false';
  }
  if (dom.networkGraph) {
    dom.networkGraph.classList.remove('hidden');
  }
  if (dom.networkTable) {
    dom.networkTable.classList.remove('hidden');
  }
  if (!networkGraphInstance) {
    networkGraphInstance = new SimpleForceGraph(dom.networkGraph, {
      onNodeClick: (node) => {
        if (node.kind === 'group') {
          state.selectedGroupId = node.id;
          renderGroupsTable();
          loadGroupDetail(node.id);
        }
      },
    });
  }
  const nodes = network.nodes.map((node) => ({
    ...node,
    color: (() => {
      if (node.kind !== 'group') {
        return '#7dd3fc';
      }
      if (node.highlight) {
        return '#f97316';
      }
      if ((node.risk_score ?? 0) >= 80) {
        return '#f87171';
      }
      if ((node.risk_score ?? 0) >= 60) {
        return '#facc15';
      }
      return '#34d399';
    })(),
  }));
  const links = network.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    amount: edge.amount,
    count: edge.count,
    label: `${edge.count} tx • ${formatCurrency(edge.amount)}`,
    directions: edge.directions,
  }));
  networkGraphInstance.setData(nodes, links);
  networkGraphInstance.setActiveNode(state.selectedGroupId);
  state.network = network;
}

function renderReportList() {
  if (!state.reports.length) {
    dom.reportList.innerHTML = '<li class="report-item">No reports recorded.</li>';
    dom.footerReports.textContent = 'Reports this session: 0';
    return;
  }
  dom.reportList.innerHTML = state.reports
    .slice()
    .reverse()
    .map((report) => `<li class="report-item">
      <strong>${report.group_id ?? 'Unknown group'}</strong>
      <span>${formatDate(report.timestamp)}</span>
      <span>${report.reason}</span>
      ${report.checks?.length ? `<span class="badge">Checks: ${report.checks.join(', ')}</span>` : ''}
    </li>`)
    .join('');
  dom.footerReports.textContent = `Reports recorded: ${state.reports.length}`;
}

function buildKeyValueTable(data) {
  if (!data || !Object.keys(data).length) {
    return '<p class="empty-state">No data available.</p>';
  }
  const rows = Object.entries(data)
    .map(([key, value]) => `<tr><th>${key}</th><td>${String(value)}</td></tr>`)
    .join('');
  return `<table class="detail-table">${rows}</table>`;
}

function createDetailCollapse(title, content, { open = false } = {}) {
  const openAttr = open ? ' open' : '';
  return `<details class="detail-collapse"${openAttr}>
    <summary>${title}</summary>
    <div class="detail-collapse-content">${content}</div>
  </details>`;
}

function renderGroupDetailContent(detail) {
  const metrics = detail.group.metrics;
  const canonical = detail.group.canonical_attributes;
  const members = detail.group.members || [];
  const transactions = detail.group.transactions || [];
  const snapshots = detail.snapshots || [];
  const checks = state.settings?.report_checks ?? [];
  const metricsTable = buildKeyValueTable({
    'Risk score': metrics.risk_score,
    'Members': metrics.member_count,
    'Transactions': metrics.transaction_count,
    'Total amount': formatCurrency(metrics.total_amount),
    'Unique counterparties': metrics.unique_counterparties,
    'Outgoing ratio': metrics.outgoing_ratio.toFixed(2),
    'First seen': formatDate(metrics.first_seen),
    'Last seen': formatDate(metrics.last_seen),
  });

  const canonicalTable = buildKeyValueTable(canonical);

  const memberCards = members
    .map((member) => {
      const attr = buildKeyValueTable(member.attributes);
      const norm = buildKeyValueTable(member.normalized_attributes);
      const signatureBlock = member.signature_history?.length
        ? `<details><summary>Signature history</summary><pre>${member.signature_history.join('\n')}</pre></details>`
        : '';
      return `<div class="detail-card member-card">
        <h3>${member.record_id ?? 'Member'} <span class="badge">${member.entity_type ?? 'entity'}</span></h3>
        <strong>Attributes</strong>
        ${attr}
        <strong>Normalized</strong>
        ${norm}
        ${signatureBlock}
      </div>`;
    })
    .join('');

  const transactionsMarkdown = transactions.length
    ? `<div class="table-container">
        <table class="data-table">
          <thead><tr><th>ID</th><th>Direction</th><th>Counterparty</th><th>Amount</th><th>Currency</th><th>Timestamp</th></tr></thead>
          <tbody>${transactions.map((tx) => `<tr>
            <td>${tx.transaction_id ?? '—'}</td>
            <td>${tx.direction ?? '—'}</td>
            <td>${tx.counterparty_id ?? '—'}</td>
            <td>${formatCurrency(tx.amount)}</td>
            <td>${tx.currency ?? '—'}</td>
            <td>${formatDate(tx.timestamp)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
    : '<p class="empty-state">No transactions in scope for this group.</p>';

  const snapshotBlock = snapshots.length
    ? `<details><summary>${snapshots.length} snapshot rows</summary><pre>${JSON.stringify(snapshots, null, 2)}</pre></details>`
    : '<p class="empty-state">No snapshots match this group.</p>';

  const checksMarkup = checks
    .map((check) => `<label class="form-row-checkbox">
      <input type="checkbox" name="report_checks" value="${check}"> ${check}
    </label>`)
    .join('');

  const detailSections = [
    createDetailCollapse('Metrics', metricsTable, { open: true }),
    createDetailCollapse('Canonical Attributes', canonicalTable),
    createDetailCollapse('Members', memberCards ? `<div class="detail-grid">${memberCards}</div>` : '<p class="empty-state">No members found.</p>'),
    createDetailCollapse('Transactions', transactionsMarkdown),
    createDetailCollapse('Snapshots', snapshotBlock),
  ];

  dom.detailContainer.classList.remove('empty');
  dom.detailContainer.innerHTML = `
    <div class="detail-stack">
      ${detailSections.join('')}
      <div class="detail-card">
        <h3>Report Group</h3>
        <form id="report-form">
          <div class="form-row">
            <label for="report-reason">Reason</label>
            <textarea id="report-reason" name="reason" rows="3" required placeholder="Describe why this group is suspicious..."></textarea>
          </div>
          <div class="form-row">
            <span>Checks</span>
            <div class="report-checks">${checksMarkup || '<p class="empty-state">No checks configured.</p>'}</div>
          </div>
          <button class="btn btn-primary" type="submit">Submit Report</button>
        </form>
      </div>
    </div>
  `;

  const reportForm = document.getElementById('report-form');
  reportForm.addEventListener('submit', (event) => submitReport(event, detail.group.group_id));
}

async function loadGroupDetail(groupId) {
  try {
    dom.detailContainer.innerHTML = '<p>Loading group details…</p>';
    const query = new URLSearchParams();
    const detail = await fetchJson(`/api/groups/${encodeURIComponent(groupId)}?${query.toString()}`);
    renderGroupDetailContent(detail);
  } catch (error) {
    console.error(error);
    dom.detailContainer.classList.remove('empty');
    dom.detailContainer.innerHTML = `<p class="error">Unable to load group detail: ${error.message}</p>`;
  }
}

async function submitReport(event, groupId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const reason = (formData.get('reason') || '').toString();
  const checks = formData.getAll('report_checks');
  if (!reason.trim()) {
    alert('Please provide a reason for the report.');
    return;
  }
  try {
    await fetchJson('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        group_id: groupId,
        reason: reason.trim(),
        checks,
      }),
    });
    event.target.reset();
    await Promise.all([loadReports(), loadGroups()]);
    alert('Report recorded successfully.');
  } catch (error) {
    console.error(error);
    alert(`Unable to submit report: ${error.message}`);
  }
}

async function loadGroups() {
  try {
    readFiltersFromForm();
    const query = buildQueryParams(state.filters);
    const response = await fetchJson(`/api/groups?${query}`);
    state.groups = response.items;
    state.summary = {
      ...state.summary,
      aggregated: response.aggregated,
      reported_ids: response.reported_ids,
      total_groups: response.total,
    };
    renderSummaryInfo();
    renderGroupsTable();
    const hadGraph = Boolean(networkGraphInstance);
    if (!hadGraph) {
      showNetworkPlaceholder('Loading network data…');
    } else if (dom.networkStatus) {
      dom.networkStatus.textContent = 'Updating network…';
      dom.networkStatus.dataset.persistent = 'true';
      dom.networkStatus.classList.remove('hidden');
      if (dom.networkGraph) {
        dom.networkGraph.classList.remove('hidden');
      }
    }
    try {
      const network = await fetchJson(`/api/network?${query}&highlight_reported=${state.settings?.default_highlight_reported !== false}`);
      renderNetworkGraph(network);
      renderNetworkTable(network);
    } catch (networkError) {
      console.error(networkError);
      const message = networkError?.message
        ? `Unable to load network data (${networkError.message}).`
        : 'Unable to load network data.';
      if (networkGraphInstance && dom.networkStatus) {
        dom.networkStatus.textContent = message;
        dom.networkStatus.dataset.persistent = 'true';
        dom.networkStatus.classList.remove('hidden');
        if (dom.networkGraph) {
          dom.networkGraph.classList.remove('hidden');
        }
      } else {
        showNetworkPlaceholder(message, true);
      }
    }
    if (state.groups.length && !state.selectedGroupId) {
      state.selectedGroupId = state.groups[0].group_id;
      renderGroupsTable();
      loadGroupDetail(state.selectedGroupId);
    }
  } catch (error) {
    console.error(error);
    dom.groupsTableContainer.innerHTML = `<p class="error">Unable to load groups: ${error.message}</p>`;
  }
}

async function loadReports() {
  try {
    state.reports = await fetchJson('/api/reports');
    renderReportList();
  } catch (error) {
    console.error(error);
    dom.reportList.innerHTML = `<li class="report-item">Unable to load reports: ${error.message}</li>`;
  }
}

async function refreshArtifacts() {
  try {
    dom.refreshArtifacts.disabled = true;
    await fetchJson('/api/actions/refresh', { method: 'POST' });
    const summary = await fetchJson('/api/summary');
    state.summary = summary;
    assignFiltersFromSummary();
    await Promise.all([loadGroups(), loadReports()]);
  } catch (error) {
    console.error(error);
    alert(`Refresh failed: ${error.message}`);
  } finally {
    dom.refreshArtifacts.disabled = false;
  }
}

function bindEvents() {
  dom.filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.selectedGroupId = null;
    loadGroups();
  });
  dom.resetFilters.addEventListener('click', () => {
    assignFiltersFromSummary();
    state.selectedGroupId = null;
    loadGroups();
  });
  dom.refreshArtifacts.addEventListener('click', refreshArtifacts);
}

async function initialise() {
  try {
    dom.detailContainer.innerHTML = '<p>Loading dataset…</p>';
    const [settings, summary] = await Promise.all([
      fetchJson('/api/settings'),
      fetchJson('/api/summary'),
    ]);
    state.settings = settings;
    state.summary = summary;
    if (settings?.title) {
      dom.title.textContent = settings.title;
      document.title = settings.title;
    }
    assignFiltersFromSummary();
    renderSummaryInfo();
    bindEvents();
    await Promise.all([loadGroups(), loadReports()]);
  } catch (error) {
    console.error(error);
    dom.detailContainer.innerHTML = `<p class="error">Unable to initialise application: ${error.message}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', initialise);
