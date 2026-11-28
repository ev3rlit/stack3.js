const descriptions = {
  table: ['상판 중앙 77점의 기준 높이 RMS 오차', 'mm'],
  bookshelf: ['지정 광선이 통과한 개구부', '/ 3'],
  cabinet: ['가운데 문틈', 'mm'],
  sofa: ['좌방석 사이 골 깊이', 'mm'],
};


function overlay(data, viewBox, label, sources) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', viewBox.join(' '));
  svg.setAttribute('aria-label', label);
  svg.setAttribute('role', 'img');
  for (const key of sources) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', data[key].section.join(' '));
    path.setAttribute('class', key === 'reference' ? key : 'dexel');
    svg.append(path);
  }
  return svg;
}

export async function addSection(id, dimensions, sectionState, dexel, scale) {
  if (!descriptions[id]) return;
  const response = await fetch('./models/sections.json');
  if (!response.ok) throw new Error('단면 측정 파일을 읽을 수 없습니다.');
  const data = (await response.json())[id];
  const [metric, unit] = descriptions[id];
  const cabinet = id === 'cabinet';
  const sources = ['reference', cabinet ? dexel : 'measured'];
  const labels = { reference: 'Three.js 원본', measured: 'Stack3', [dexel]: 'Stack3 ' + scale + '×' };
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  details.open = sectionState === 'open' || ((cabinet || id === 'sofa') && sectionState !== 'closed');
  summary.textContent = '단면 비교 · ' + metric;
  details.append(summary);
  const legend = document.createElement('p');
  legend.className = 'section-legend';
  for (const key of sources) {
    const entry = document.createElement('span');
    entry.className = key === 'reference' ? key : 'dexel';
    const value = id === 'cabinet' ? data[key].value.toFixed(2) : data[key].value;
    entry.textContent = cabinet
      ? labels[key] + ' · 깊이 ' + value + ' mm · 폭 ' + data[key].widthMm.toFixed(2) + ' mm'
      : labels[key] + ' ' + value + ' ' + unit;
    legend.append(entry);
  }
  const height = document.createElement('span');
  height.textContent = id === 'sofa' ? '좌우 수직 단면 Z = 0 mm' : '수평 단면 ' + Math.round(data.y * 1000) + ' mm';
  legend.append(height);
  const w = dimensions[0] * 1000 + 40, h = dimensions[2] * 1000 + 40;
  if (id === 'sofa') {
    const heightMm = dimensions[1] * 1000;
    details.append(legend, overlay(data, [-w/2, -heightMm-20, w, heightMm+40], '두 좌방석을 가르는 수직 단면', sources));
    const caption = document.createElement('p');
    caption.textContent = '이음부 확대 · 중앙 양옆 5 mm의 높이를 양옆 200 mm의 좌면과 비교합니다.';
    details.append(caption, overlay(data, [-72, -450, 300, 180], '좌방석 사이 골 확대', sources));
  } else {
    details.append(legend, overlay(data, [-w/2, -h/2, w, h], '전체 수평 단면', sources));
  }
  if (id === 'cabinet') {
    const caption = document.createElement('p');
    caption.textContent = '가운데 문틈 확대 · 폭은 문 표면에서 ' + data.widthProbeDepthMm + ' mm 들어간 지점에서 측정합니다. ' +
      '중앙 40 mm 구간의 평균 표면 오차는 ' + scale + '×에서 ' + data[dexel].profileMeanErrorMm.toFixed(3) + ' mm입니다.';
    details.append(caption, overlay(data, [-54, -206, 108, 53], '같은 수평 단면의 가운데 문틈 확대', sources));
  }
  document.querySelector('#resources').after(details);
}
