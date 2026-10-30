// The selected File is passed to the local Worker. This UI never reads the
// whole archive into an ArrayBuffer and never uploads its contents.
import {PATCH_VERSION} from './release.js';
const $ = selector => document.querySelector(selector);
const state = {file: null, revision: 0, ready: false, busy: false, worker: null, active: null,
  sequence: 0, verifiedKey: '', inspection: null, resultUrl: null, phase: 'boot', lastStage: ''};

function size(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '확인 중';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes.toLocaleString()} B`;
}
function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000)), minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
}
function setStatus(message, kind = '') { $('#status').textContent = message; $('#status').className = kind; }
function archiveStatus(message, kind = '') { $('#archive-status').textContent = message; $('#archive-status').className = `archive-status ${kind}`; }
function log(message, kind = '') {
  const li = document.createElement('li'); li.textContent = message; li.className = kind;
  const list = $('#log'); list.append(li); while (list.children.length > 120) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
}
function options() {
  return {patchExe: $('#patch-exe').checked, patchSettings: $('#patch-settings').checked,
    installPath: $('#install-path').value.trim().replaceAll('/', '\\').replace(/\\+$/, ''),
    camera: {profile: 'virtual', vid: 'CAFE', pid: '0002'}};
}
function validation(value) {
  if (!value.patchExe && !value.patchSettings) return {message: '적용할 패치를 한 가지 이상 선택해 주세요.'};
  if (!value.patchSettings) return null;
  if (!/^[A-Za-z]:\\/.test(value.installPath) || /[<>"|?*\r\n\0]/.test(value.installPath))
    return {field: '#install-path', message: '게임 폴더를 C:\\prineohk\\game처럼 Windows 전체 경로로 입력해 주세요.'};
  return null;
}
function requiredKey() { const value = options(); return `${state.revision}:${Number(value.patchExe)}:${Number(value.patchSettings)}`; }
function clearResult() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = null; $('#result').hidden = true; $('#download').removeAttribute('href');
  $('#changed-files').replaceChildren();
}
function filesList(target, entries, emptyMessage) {
  target.replaceChildren();
  if (!entries.length) { const li = document.createElement('li'); li.className = 'placeholder'; li.textContent = emptyMessage; target.append(li); return; }
  for (const entry of entries) {
    const item = typeof entry === 'string' ? {path: entry} : entry;
    const li = document.createElement('li'), name = document.createElement('span'), bytes = document.createElement('span');
    name.className = 'target-path'; name.textContent = item.outputPath || item.path || item.archivePath || item.name || '대상 파일';
    bytes.className = 'target-size'; bytes.textContent = (Number.isFinite(item.size) ? size(item.size) : '') + (item.verificationOnly ? ' · 검증 전용' : '');
    li.append(name, bytes); target.append(li);
  }
}
function refresh() {
  const value = options(), invalid = validation(value), count = (value.patchExe ? 4 : 0) + (value.patchSettings ? 2 : 0);
  const list = $('#selection-list'); list.replaceChildren();
  for (const title of [value.patchExe && `실행 보정 ${PATCH_VERSION} · 일본어 안내 포함`, value.patchSettings && 'QR 리더 · 실행 설정'].filter(Boolean)) {
    const li = document.createElement('li'); li.textContent = title; list.append(li);
  }
  if (!list.children.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '선택한 패치가 없습니다'; list.append(li); }
  $('#archive-size').textContent = state.file ? size(state.file.size) : '선택 안 함';
  $('#target-count').textContent = state.inspection && state.verifiedKey === requiredKey()
    ? `${(state.inspection.entries || []).length || count}개` : `최대 ${count}개`;
  if (!state.resultUrl) {
    const sum = state.inspection?.summary?.targetBytes ?? state.inspection?.entries?.reduce((n, entry) => n + (entry.size || 0), 0);
    $('#output-size-label').textContent = '처리할 파일 용량';
    $('#output-size').textContent = state.verifiedKey === requiredKey() && Number.isFinite(sum) ? size(sum) : '검사 후 표시';
  }
  $('#path-summary').textContent = value.patchSettings ? value.installPath || '경로를 입력하세요' : '원본 설정 유지';
  $('#camera-summary').textContent = value.patchSettings ? '프리파라 가상카메라 · 고정' : '가상카메라 설정 변경 안 함';
  $('#settings-group').disabled = state.busy || !value.patchSettings;
  $('#install-path').removeAttribute('aria-invalid');
  if (invalid?.field) $(invalid.field).setAttribute('aria-invalid', 'true');
  $('#settings-error').hidden = !invalid; $('#settings-error').textContent = invalid?.message || '';
  for (const id of ['#archive', '#patch-exe', '#patch-settings']) $(id).disabled = state.busy;
  $('#verify').disabled = state.busy || !state.ready || !state.file || !!invalid;
  $('#verify').textContent = state.verifiedKey === requiredKey() ? '대상 파일 다시 확인' : '대상 파일 확인';
  $('#build').disabled = state.busy || !state.ready || !state.file || !!invalid || state.verifiedKey !== requiredKey();
  $('#cancel').hidden = !state.busy; $('#clear').disabled = state.busy;
  if (state.inspection && state.verifiedKey === requiredKey()) {
    const summary = state.inspection.summary || {};
    $('#space-note').textContent = Number.isFinite(summary.bytesRead)
      ? `원본에서 ${size(summary.bytesRead)}를 읽어 필요한 파일을 확인했습니다. 결과 ZIP에는 변경 파일만 들어갑니다.`
      : '필요한 대상 파일을 확인했습니다. 결과 ZIP에는 변경 파일과 적용 안내만 들어갑니다.';
  } else $('#space-note').textContent = '원본의 필요한 파일만 확인합니다. 결과 ZIP을 저장할 공간을 준비하세요.';
}
function invalidateInspection() {
  state.verifiedKey = ''; state.inspection = null; clearResult();
  filesList($('#target-list'), [], '원본 검사 후 실제 파일 경로를 표시합니다.');
  $('#progress').value = 0; $('#state-badge').textContent = '검사 대기'; refresh();
}
function fail(message, code = '') {
  state.busy = false; state.active = null; state.verifiedKey = ''; state.phase = 'error'; clearResult();
  $('#progress').value = 0; $('#state-badge').textContent = code === 'CANCELLED' ? '취소됨' : '확인 필요';
  setStatus(message, code === 'CANCELLED' ? '' : 'error');
  archiveStatus(message, code === 'CANCELLED' ? '' : 'error');
  log(message, code === 'CANCELLED' ? '' : 'error'); refresh();
}
function progress(data) {
  const labels = {init: '준비', runtime: '준비', inspect: '파일 확인', scan: '압축 목록 확인', extract: '대상 추출',
    integrity: '내용 확인', verify: '내용 확인', patch: '패치 적용', settings: '설정 반영', zip: 'ZIP 생성', save: 'ZIP 생성'};
  const stage = data.stage || 'work'; $('#state-badge').textContent = labels[stage] || '진행 중';
  const percentage = Number.isFinite(data.percent) ? data.percent
    : Number.isFinite(data.total) && data.total > 0 && Number.isFinite(data.done) ? 100 * data.done / data.total : null;
  if (percentage === null) $('#progress').removeAttribute('value'); else $('#progress').value = Math.max(0, Math.min(100, percentage));
  if (data.message) setStatus(data.message);
  if (state.lastStage !== stage && data.message) { log(data.message); state.lastStage = stage; }
}
function complete(data) {
  const blob = data.blob ?? data.result?.blob;
  if (!(blob instanceof Blob)) { fail('결과 ZIP을 받지 못했습니다. 대상 파일을 다시 확인해 주세요.'); return; }
  const elapsed = duration(performance.now() - state.active.startedAt);
  clearResult(); state.resultUrl = URL.createObjectURL(blob);
  const link = $('#download'); link.href = state.resultUrl; link.download = data.filename || data.result?.filename || 'PriPara_Arcade_Patch.zip';
  const changed = data.changedFiles || data.report?.changedFiles || data.result?.changedFiles || [];
  filesList($('#changed-files'), changed, '변경 파일의 자세한 목록은 ZIP에 포함된 작업 보고서에서 확인할 수 있습니다.');
  $('#result-message').textContent = `${size(blob.size)} · 생성 시간 ${elapsed}. 아래 버튼으로 저장한 뒤 ZIP의 적용 안내를 확인하세요.`;
  $('#result').hidden = false; $('#progress').value = 100; $('#state-badge').textContent = '다운로드 준비';
  $('#output-size-label').textContent = '결과 ZIP'; $('#output-size').textContent = size(blob.size);
  setStatus(`패치 ZIP을 만들었습니다 (${size(blob.size)}). ZIP 다운로드를 눌러 저장하세요.`, 'success');
  log(`변경 파일 ZIP 준비 완료 · ${size(blob.size)} · ${elapsed}`, 'success');
  state.busy = false; state.active = null; state.phase = 'complete'; refresh();
}
function startWorker() {
  state.ready = false;
  const instance = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  state.worker = instance;
  instance.onmessage = ({data}) => {
    if (state.worker !== instance || !data || typeof data.type !== 'string') return;
    if (data.type === 'ready' || data.type === 'runtimeReady') {
      state.ready = true; $('#launch-help').hidden = true;
      if (!state.busy) {
        $('#progress').value = 0;
        if (state.phase === 'cancelled') { $('#state-badge').textContent = '취소됨'; setStatus('작업을 취소했습니다. 선택한 파일을 다시 확인할 수 있습니다.'); }
        else { $('#state-badge').textContent = '검사 대기'; setStatus('원본 RAR를 선택하면 필요한 대상 파일을 확인합니다.'); }
      }
      refresh(); if (state.file && state.phase === 'boot') inspect(); return;
    }
    if (data.requestId !== undefined && data.requestId !== state.active?.id) return;
    if (data.type === 'progress') { progress(data); return; }
    if (data.type === 'error') { fail(data.message || '파일을 처리하지 못했습니다. 원본과 설정을 확인해 주세요.', data.code); return; }
    if (data.type === 'inspected' && state.active?.type === 'inspect') {
      const result = data.result || {};
      if (result.ok === false || result.entries?.some(entry => entry.verified === false)) { fail('선택한 대상 파일을 확인하지 못했습니다. 원본 자료를 확인해 주세요.'); return; }
      state.inspection = result; state.verifiedKey = state.active.key;
      state.busy = false; state.active = null; state.phase = 'verified';
      filesList($('#target-list'), result.entries || [], '대상 파일 확인을 마쳤습니다.');
      $('#progress').value = 100; $('#state-badge').textContent = '대상 확인 완료';
      const count = result.entries?.length || (options().patchExe ? 4 : 0) + (options().patchSettings ? 2 : 0);
      archiveStatus(`필요한 대상 ${count}개 SHA-256 확인 완료 · 패치 ZIP을 만들 수 있습니다.`, 'success');
      setStatus('대상 원본의 SHA-256이 기준과 일치합니다. 패치 ZIP 만들기를 눌러 주세요.', 'success');
      log(`대상 파일 ${count}개 SHA-256 확인 완료`, 'success'); refresh(); return;
    }
    if (data.type === 'complete' && state.active?.type === 'build') complete(data);
  };
  instance.onerror = event => {
    if (state.worker !== instance) return;
    state.ready = false; fail('처리기를 준비하거나 파일을 처리하는 중 오류가 발생했습니다. 선택 및 결과 정리 후 다시 시도해 주세요.');
    if (event.message) log(event.message, 'error');
  };
  instance.postMessage({type: 'init'});
}
function inspect() {
  if (state.busy || !state.ready || !state.file) return;
  const value = options(), invalid = validation(value);
  if (invalid) { setStatus(invalid.message, 'error'); if (invalid.field) $(invalid.field).focus(); return; }
  if (state.file.size <= 0) { fail('비어 있는 파일은 사용할 수 없습니다. 원본 RAR를 선택해 주세요.'); return; }
  clearResult(); state.verifiedKey = ''; state.inspection = null; state.busy = true; state.phase = 'inspect'; state.lastStage = '';
  state.active = {id: ++state.sequence, type: 'inspect', key: requiredKey(), startedAt: performance.now()};
  $('#progress').removeAttribute('value'); $('#state-badge').textContent = '대상 파일 확인';
  archiveStatus('필요한 파일을 확인하고 있습니다. 원본은 업로드하지 않습니다.');
  setStatus('원본 RAR에서 선택한 패치에 필요한 파일을 확인합니다.'); log('로컬 RAR 대상 파일 확인을 시작합니다.'); refresh();
  state.worker.postMessage({type: 'inspect', requestId: state.active.id, file: state.file, options: value});
}
$('#archive').addEventListener('change', () => {
  state.file = $('#archive').files[0] || null; state.revision++; invalidateInspection();
  $('#archive-name').textContent = state.file ? `${state.file.name} · ${size(state.file.size)}` : 'RAR 파일을 선택하세요';
  $('#archive-name').classList.toggle('selected', !!state.file);
  if (state.file) { archiveStatus(state.ready ? '필요한 대상 파일을 확인합니다.' : '패처를 준비한 뒤 파일을 확인합니다.'); if (state.ready) inspect(); }
  else archiveStatus('파일을 선택하면 필요한 대상 파일을 확인합니다.');
});
for (const id of ['#patch-exe', '#patch-settings']) $(id).addEventListener('change', () => {
  invalidateInspection(); if (state.file && state.ready && !validation(options())) inspect();
});
$('#install-path').addEventListener('input', () => { clearResult(); refresh(); });
$('#verify').addEventListener('click', inspect);
$('#build').addEventListener('click', () => {
  if (state.busy || !state.ready || !state.file || state.verifiedKey !== requiredKey()) return;
  const value = options(), invalid = validation(value); if (invalid) { setStatus(invalid.message, 'error'); return; }
  clearResult(); state.busy = true; state.phase = 'build'; state.lastStage = '';
  state.active = {id: ++state.sequence, type: 'build', startedAt: performance.now()};
  $('#progress').removeAttribute('value'); $('#state-badge').textContent = '패치 준비';
  setStatus('선택한 패치를 적용하고 변경 파일 ZIP을 만듭니다.'); log('변경 파일 ZIP 생성을 시작합니다.'); refresh();
  state.worker.postMessage({type: 'build', requestId: state.active.id, file: state.file, options: value});
});
$('#cancel').addEventListener('click', () => {
  if (!state.busy) return;
  state.worker?.postMessage({type: 'cancel', requestId: state.active?.id});
  state.worker?.terminate(); state.worker = null; state.active = null; state.busy = false; state.phase = 'cancelled';
  state.verifiedKey = ''; state.inspection = null; clearResult(); $('#progress').value = 0; $('#state-badge').textContent = '취소됨';
  archiveStatus('작업을 취소했습니다. 다시 확인할 수 있습니다.'); setStatus('작업을 취소하고 작업 데이터를 해제했습니다.'); log('작업 취소 · 원본 파일은 그대로 유지됩니다.');
  startWorker(); refresh();
});
$('#clear').addEventListener('click', () => {
  if (state.busy) return;
  state.worker?.postMessage({type: 'clear'}); state.worker?.terminate(); state.worker = null;
  state.file = null; state.revision++; state.active = null; state.inspection = null; state.verifiedKey = ''; state.phase = 'idle';
  $('#archive').value = ''; $('#archive-name').textContent = 'RAR 파일을 선택하세요'; $('#archive-name').classList.remove('selected');
  $('#log').replaceChildren(); clearResult(); filesList($('#target-list'), [], '원본 검사 후 실제 파일 경로를 표시합니다.');
  archiveStatus('파일을 선택하면 필요한 대상 파일을 확인합니다.'); $('#progress').value = 0; $('#state-badge').textContent = '준비';
  setStatus('선택한 원본과 작업 결과를 정리했습니다.'); startWorker(); refresh();
});
$('#download').addEventListener('click', () => { if (state.resultUrl) { setStatus('ZIP 다운로드를 시작했습니다. 브라우저의 다운로드 목록을 확인해 주세요.', 'success'); log('결과 ZIP 다운로드 시작'); } });
window.addEventListener('beforeunload', () => { state.worker?.terminate(); if (state.resultUrl) URL.revokeObjectURL(state.resultUrl); });
refresh();
if (location.protocol === 'file:') {
  state.phase = 'error'; setStatus('웹 서버 주소로 접속해 주세요. index.html을 직접 여는 방식은 지원하지 않습니다.', 'error');
} else if (!globalThis.Worker || !globalThis.Blob || !globalThis.URL?.createObjectURL || !globalThis.File) {
  state.phase = 'error'; setStatus('이 브라우저는 필요한 로컬 파일 처리를 지원하지 않습니다. PC의 Chrome 또는 Edge에서 열어 주세요.', 'error');
} else {
  try { startWorker(); } catch (error) { state.ready = false; fail('패처를 준비하지 못했습니다. 웹 서버 주소와 브라우저를 확인해 주세요.'); }
}
