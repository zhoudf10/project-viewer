(function () {
  'use strict';

  // 项目数据子文件夹：datas/<项目名>/ 下存放 knowledge-graph.json 等分析文件的目录。
  // 修改此值后运行 python bliud.py 重新构建即可生效（构建脚本会动态读取这里）。
  var UA_DATA_SUBFOLDER = '.ua';

  var manifest = window.UA_MANIFEST || { projects: [] };
  var projects = Array.isArray(manifest.projects) ? manifest.projects : [];

  var grid = document.getElementById('project-grid');
  var empty = document.getElementById('empty-state');
  var countEl = document.getElementById('list-count');
  var input = document.getElementById('filter');
  var pager = document.getElementById('pager');

  var PAGE_SIZE = 10;
  var currentPage = 1;
  var currentKeyword = '';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    if (!value) return '未知时间';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function statText(project) {
    var k = project.stats && project.stats.knowledge;
    var d = project.stats && project.stats.domain;
    var parts = [];
    if (k && k.nodes) parts.push('知识图谱 ' + k.nodes + ' 节点');
    if (d && d.nodes) parts.push('领域图谱 ' + d.nodes + ' 节点');
    return parts.length ? parts.join(' · ') : '暂无图谱';
  }

  function card(project) {
    var a = document.createElement('a');
    a.className = 'project-card';
    a.href = 'viewer.html#project=' + encodeURIComponent(project.id);

    a.appendChild(el('h2', null, project.name || project.id));
    a.appendChild(el('div', 'desc', project.description || '（该项目没有提供描述）'));

    var tags = [].concat(project.frameworks || [], project.languages || []).slice(0, 6);
    if (tags.length) {
      var tagRow = el('div', 'tag-row');
      tags.forEach(function (t) { tagRow.appendChild(el('span', 'tag', t)); });
      a.appendChild(tagRow);
    }

    var meta = el('div', 'project-meta');
    var date = el('span');
    date.appendChild(el('b', null, '分析于 '));
    date.appendChild(document.createTextNode(formatDate(project.analyzedAt)));
    meta.appendChild(date);
    meta.appendChild(el('span', null, statText(project)));
    a.appendChild(meta);

    return a;
  }

  function pageNumbers(current, total) {
    var pages = [];
    if (total <= 7) {
      for (var i = 1; i <= total; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    if (start > 2) pages.push('...');
    for (var j = start; j <= end; j++) pages.push(j);
    if (end < total - 1) pages.push('...');
    pages.push(total);
    return pages;
  }

  function pagerButton(label, page, options) {
    var opts = options || {};
    var btn = el('button', null, label);
    btn.type = 'button';
    if (opts.active) btn.className = 'active';
    if (opts.disabled) btn.disabled = true;
    btn.addEventListener('click', function () {
      currentPage = page;
      render(currentKeyword, true);
      window.scrollTo(0, 0);
    });
    return btn;
  }

  function renderPager(totalPages) {
    if (!pager) return;
    pager.textContent = '';
    pager.hidden = totalPages <= 1;
    if (pager.hidden) return;

    pager.appendChild(pagerButton('上一页', currentPage - 1, { disabled: currentPage === 1 }));
    pageNumbers(currentPage, totalPages).forEach(function (page) {
      if (page === '...') {
        pager.appendChild(el('span', 'page-ellipsis', '…'));
        return;
      }
      pager.appendChild(pagerButton(String(page), page, { active: page === currentPage }));
    });
    pager.appendChild(pagerButton('下一页', currentPage + 1, { disabled: currentPage === totalPages }));
  }

  function render(keyword, keepPage) {
    if (!keepPage) {
      currentKeyword = keyword || '';
      currentPage = 1;
    }

    var kw = (keyword || '').trim().toLowerCase();
    var list = projects.filter(function (p) {
      if (!kw) return true;
      var haystack = [p.id, p.name, p.description]
        .concat(p.languages || [], p.frameworks || [])
        .join(' ')
        .toLowerCase();
      return haystack.indexOf(kw) !== -1;
    });

    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageItems = list.slice(start, start + PAGE_SIZE);

    grid.textContent = '';
    pageItems.forEach(function (p) { grid.appendChild(card(p)); });

    var text = projects.length
      ? (kw ? '匹配 ' + list.length + ' / ' + projects.length + ' 个项目' : '共 ' + projects.length + ' 个项目')
      : '';
    if (text && totalPages > 1) text += ' · 第 ' + currentPage + ' / ' + totalPages + ' 页';
    countEl.textContent = text;
    empty.hidden = list.length > 0;

    renderPager(totalPages);

    if (!projects.length) {
      empty.textContent = '';
      empty.appendChild(document.createTextNode('没有可显示的项目。运行 '));
      var cmd = el('code', null, 'python bliud.py datas_dir=<项目目录>');
      empty.appendChild(cmd);
      empty.appendChild(document.createTextNode(' 导入项目后刷新本页。'));
    }
  }

  input.addEventListener('input', function () { render(input.value); });
  render('');
})();
